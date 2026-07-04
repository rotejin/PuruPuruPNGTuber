# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import json
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial
from urllib.parse import parse_qs, unquote, urlsplit
import errno
import os
import platform
import shutil
import subprocess
import webbrowser

PREFERRED_PORT_START = 8223
PREFERRED_PORT_END = 8273
FALLBACK_PORT_START = 8000
FALLBACK_PORT_END = 8050
TRUSTED_API_HOSTS = {"127.0.0.1", "localhost"}
OBS_SNAPSHOT_MAX_BYTES = 24 * 1024 * 1024
MAX_LOCAL_SERVER_THREADS = 64
REQUEST_HEADER_READ_TIMEOUT_SECONDS = 5.0
REQUEST_BODY_READ_TIMEOUT_SECONDS = 2.0
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'wasm-unsafe-eval'; "
    "connect-src 'self'; "
    "worker-src 'self' blob:; "
    "img-src 'self' data: blob:; "
    "style-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "frame-ancestors 'none'"
)


class ObsHub:
    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._seq = 0
        self.latest_input: dict | None = None
        self.latest_snapshot: dict | None = None
        self.latest_config: dict = {"preset": "light"}
        self.latest_event: tuple[str, dict] | None = None

    def set_input(self, payload: dict) -> int:
        with self._condition:
            self._seq += 1
            self.latest_input = payload
            self.latest_event = ("input", payload)
            self._condition.notify_all()
            return self._seq

    def wait_next(self, last_seq: int, timeout: float = 10.0) -> tuple[int, str, dict | None]:
        with self._condition:
            last_seq = min(last_seq, self._seq)
            deadline = time.monotonic() + timeout
            while self._seq == last_seq:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(remaining)
            if not self.latest_event:
                return self._seq, "input", self.latest_input
            event_name, payload = self.latest_event
            return self._seq, event_name, payload

    def set_snapshot(self, payload: dict) -> None:
        with self._condition:
            self._seq += 1
            self.latest_snapshot = payload
            self.latest_event = (
                "snapshot",
                {
                    "createdAt": payload.get("createdAt"),
                    "version": payload.get("version"),
                },
            )
            self._condition.notify_all()

    def set_config(self, payload: dict) -> None:
        preset = str(payload.get("preset") or "light")
        if preset not in {"light", "standard", "high"}:
            preset = "light"
        with self._condition:
            self._seq += 1
            self.latest_config = {"preset": preset}
            self.latest_event = ("config", self.latest_config)
            self._condition.notify_all()


OBS_HUB = ObsHub()


def parse_nonnegative_int(value: str | None, default: int = 0) -> int:
    try:
        parsed = int(value or "")
    except (TypeError, ValueError):
        return default
    return max(default, parsed)


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, *args, max_threads: int = MAX_LOCAL_SERVER_THREADS, **kwargs) -> None:
        self._request_semaphore = threading.BoundedSemaphore(max_threads)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address) -> None:
        if not self._request_semaphore.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._request_semaphore.release()
            raise

    def process_request_thread(self, request, client_address) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_semaphore.release()


def header_hostname(value: str | None) -> str:
    if not value:
        return ""
    try:
        parsed = urlsplit(f"//{value}")
        return (parsed.hostname or "").lower()
    except ValueError:
        return ""


def url_hostname(value: str | None) -> str:
    if not value:
        return ""
    try:
        return (urlsplit(value).hostname or "").lower()
    except ValueError:
        return ""


class NoCacheHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    allowed_extensions = {".html", ".css", ".js", ".json", ".png", ".ico", ".wasm", ".mjs", ".task", ".woff2"}
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".woff2": "font/woff2"}

    def handle_one_request(self) -> None:
        old_timeout = self.connection.gettimeout()
        self.connection.settimeout(REQUEST_HEADER_READ_TIMEOUT_SECONDS)
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError, OSError):
            self.close_connection = True
            return
        finally:
            self.connection.settimeout(old_timeout)

    def read_json_body(self, max_bytes: int) -> dict:
        content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise ValueError("invalid content type")
        transfer_encoding = (self.headers.get("Transfer-Encoding") or "").strip().lower()
        if transfer_encoding and transfer_encoding != "identity":
            self.close_connection = True
            raise ValueError("unsupported transfer encoding")
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError as error:
            self.close_connection = True
            raise ValueError("invalid content length") from error
        if length <= 0 or length > max_bytes:
            if length > max_bytes:
                self.close_connection = True
                self.discard_request_body(max_bytes)
            raise ValueError("invalid content length")
        old_timeout = self.connection.gettimeout()
        self.connection.settimeout(REQUEST_BODY_READ_TIMEOUT_SECONDS)
        try:
            body = self.rfile.read(length)
        except OSError as error:
            self.close_connection = True
            raise ValueError("request body read timeout") from error
        finally:
            self.connection.settimeout(old_timeout)
        if len(body) != length:
            self.close_connection = True
            raise ValueError("incomplete request body")
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("json body must be object")
        return payload

    def discard_request_body(self, max_bytes: int = 64 * 1024) -> None:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            self.close_connection = True
            return
        if length <= 0:
            return
        if length > max_bytes:
            self.close_connection = True
        drain_limit = length if length <= max_bytes + 64 * 1024 else max_bytes
        old_timeout = self.connection.gettimeout()
        if length > max_bytes:
            self.connection.settimeout(0.05)
        try:
            remaining = drain_limit
            while remaining > 0:
                chunk = self.rfile.read(min(remaining, 64 * 1024))
                if not chunk:
                    break
                remaining -= len(chunk)
        except OSError:
            return
        finally:
            if length > max_bytes:
                self.connection.settimeout(old_timeout)

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def is_trusted_api_client(self) -> bool:
        if header_hostname(self.headers.get("Host")) not in TRUSTED_API_HOSTS:
            return False

        origin = self.headers.get("Origin")
        if origin and url_hostname(origin) not in TRUSTED_API_HOSTS:
            return False

        referer = self.headers.get("Referer")
        if not origin and referer and url_hostname(referer) not in TRUSTED_API_HOSTS:
            return False

        return True

    def is_trusted_api_read_request(self) -> bool:
        return self.is_trusted_api_client()

    def is_trusted_api_request(self) -> bool:
        if not self.is_trusted_api_client():
            return False

        content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        return content_type == "application/json"

    def is_allowed_path(self) -> bool:
        request_path = unquote(urlsplit(self.path).path)
        if "\\" in request_path:
            return False
        path = Path(request_path)
        if ".." in path.parts:
            return False
        if any(part.startswith(".") for part in path.parts):
            return False
        allowed = request_path.endswith("/") or path.suffix.lower() in self.allowed_extensions
        if not allowed:
            return False
        try:
            root = Path(self.directory).resolve()
            target = (root / request_path.lstrip("/")).resolve()
            target.relative_to(root)
        except (OSError, ValueError):
            return False
        return True

    def handle_obs_events(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        query = parse_qs(urlsplit(self.path).query)
        query_last_event_id = (query.get("lastEventId") or [""])[0]
        last_seq = parse_nonnegative_int(self.headers.get("Last-Event-ID") or query_last_event_id)
        try:
            while True:
                seq, event_name, payload = OBS_HUB.wait_next(last_seq, timeout=10.0)
                if seq == last_seq:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue

                last_seq = seq
                data = json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                self.wfile.write(f"event: {event_name}\n".encode("ascii"))
                self.wfile.write(f"id: {seq}\n".encode("ascii"))
                self.wfile.write(b"data: ")
                self.wfile.write(data)
                self.wfile.write(b"\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError, OSError):
            return

    def do_GET(self) -> None:
        request_path = urlsplit(self.path).path
        if request_path.startswith("/api/") and not self.is_trusted_api_read_request():
            self.close_connection = True
            self.send_json(403, {"ok": False})
            return
        if request_path == "/api/obs/snapshot":
            self.send_json(200, OBS_HUB.latest_snapshot or {})
            return
        if request_path == "/api/obs/config":
            self.send_json(200, OBS_HUB.latest_config)
            return
        if request_path == "/api/obs/events":
            self.handle_obs_events()
            return
        if not self.is_allowed_path():
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_POST(self) -> None:
        request_path = urlsplit(self.path).path
        if request_path.startswith("/api/") and not self.is_trusted_api_request():
            self.discard_request_body()
            self.close_connection = True
            self.send_json(403, {"ok": False})
            return

        if request_path == "/api/obs/input":
            try:
                payload = self.read_json_body(64 * 1024)
                payload["serverReceivedAt"] = time.time()
                seq = OBS_HUB.set_input(payload)
                self.send_json(200, {"ok": True, "seq": seq})
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                self.close_connection = True
                self.send_json(400, {"ok": False})
            return

        if request_path == "/api/obs/snapshot":
            try:
                payload = self.read_json_body(OBS_SNAPSHOT_MAX_BYTES)
                OBS_HUB.set_snapshot(payload)
                self.send_json(200, {"ok": True})
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                self.close_connection = True
                self.send_json(400, {"ok": False})
            return

        if request_path == "/api/obs/config":
            try:
                payload = self.read_json_body(64 * 1024)
                OBS_HUB.set_config(payload)
                self.send_json(200, {"ok": True})
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                self.close_connection = True
                self.send_json(400, {"ok": False})
            return

        self.send_error(404, "Not Found")

    def do_HEAD(self) -> None:
        if not self.is_allowed_path():
            self.send_error(404, "Not Found")
            return
        super().do_HEAD()

    def log_message(self, format: str, *args) -> None:
        request_path = urlsplit(self.path).path
        if request_path in {"/api/obs/input", "/api/obs/events"}:
            return
        super().log_message(format, *args)

    def list_directory(self, path: str):
        self.send_error(404, "No directory listing")
        return None

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        self.send_header("Permissions-Policy", "camera=(self), microphone=(self)")
        super().end_headers()


def chrome_candidate_paths() -> list[str]:
    system = platform.system()
    candidates: list[str] = []

    def add_file(path: str) -> None:
        expanded = os.path.expandvars(os.path.expanduser(path))
        if os.path.isfile(expanded):
            candidates.append(expanded)

    def add_command(command: str) -> None:
        found = shutil.which(command)
        if found:
            candidates.append(found)

    if system == "Windows":
        add_file(r"C:\Program Files\Google\Chrome\Application\chrome.exe")
        add_file(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe")
        add_file(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")
        add_command("chrome.exe")
        add_command("chrome")
    elif system == "Darwin":
        add_file("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        add_file("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        add_file("/Applications/Chromium.app/Contents/MacOS/Chromium")
        add_file("~/Applications/Chromium.app/Contents/MacOS/Chromium")
        add_command("google-chrome")
        add_command("google-chrome-stable")
        add_command("chromium")
        add_command("chromium-browser")
    else:
        add_command("google-chrome")
        add_command("google-chrome-stable")
        add_command("chromium")
        add_command("chromium-browser")

    unique: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = os.path.normcase(os.path.abspath(candidate))
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def open_in_chrome(url: str) -> None:
    # Chrome / Chromium を優先して開く。見つからない場合だけ既定ブラウザへフォールバックする。
    for path in chrome_candidate_paths():
        try:
            subprocess.Popen([path, "--new-window", url])
            return
        except OSError:
            pass
    try:
        webbrowser.get("chrome").open(url)
        return
    except webbrowser.Error:
        pass
    # 最終フォールバック: Chrome未検出時はデフォルトブラウザ
    webbrowser.open(url)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    handler = partial(NoCacheHandler, directory=str(root))
    server = None
    port = PREFERRED_PORT_START
    # 8000番台前半は他のローカルアプリと衝突しやすいため、
    # まずこのプロジェクト用の優先ポートを試し、埋まっている時だけ従来範囲へフォールバックする。
    candidate_ports = list(range(PREFERRED_PORT_START, PREFERRED_PORT_END + 1)) + list(
        range(FALLBACK_PORT_START, FALLBACK_PORT_END + 1)
    )
    for candidate_port in candidate_ports:
        try:
            server = BoundedThreadingHTTPServer(("127.0.0.1", candidate_port), handler)
            port = candidate_port
            break
        except OSError as error:
            address_in_use = error.errno == errno.EADDRINUSE or getattr(error, "winerror", None) == 10048
            if not address_in_use:
                raise
    if server is None:
        raise RuntimeError(
            f"空きポートが見つかりませんでした（{PREFERRED_PORT_START}-{PREFERRED_PORT_END}, "
            f"{FALLBACK_PORT_START}-{FALLBACK_PORT_END}）。"
        )
    print(f"Serving {root} at http://127.0.0.1:{port}/")
    open_in_chrome(f"http://127.0.0.1:{port}/?app=move-avatar")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
