# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKSUM_FILES = (
    ROOT / "vendor" / "mediapipe" / "SHASUMS256.txt",
    ROOT / "vendor" / "fonts" / "zen-maru-gothic" / "SHASUMS256.txt",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_checksum_file(checksum_file: Path) -> list[str]:
    errors: list[str] = []
    base_dir = checksum_file.parent
    for line_number, raw_line in enumerate(checksum_file.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        try:
            expected, relative = line.split(None, 1)
        except ValueError:
            errors.append(f"{checksum_file}:{line_number}: invalid line")
            continue
        relative = relative.strip()
        path = (base_dir / relative).resolve()
        try:
            path.relative_to(base_dir.resolve())
        except ValueError:
            errors.append(f"{checksum_file}:{line_number}: path escapes checksum directory: {relative}")
            continue
        if not path.is_file():
            errors.append(f"{checksum_file}:{line_number}: missing file: {relative}")
            continue
        actual = sha256_file(path)
        if actual.lower() != expected.lower():
            errors.append(f"{relative}: expected {expected}, got {actual}")
    return errors


def main() -> int:
    errors: list[str] = []
    for checksum_file in CHECKSUM_FILES:
        if not checksum_file.is_file():
            errors.append(f"missing checksum file: {checksum_file.relative_to(ROOT)}")
            continue
        errors.extend(verify_checksum_file(checksum_file))
    if errors:
        print("Vendor checksum verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Vendor checksum verification OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
