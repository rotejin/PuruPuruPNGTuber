# Dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY . .

# The app's local server binds to 127.0.0.1 by default.
# Inside Docker, that would only be reachable inside the container,
# so patch it to listen on all container interfaces.
RUN python - <<'PY'
from pathlib import Path

path = Path("scripts/run_local_server.py")
text = path.read_text(encoding="utf-8")
text = text.replace(
    'BoundedThreadingHTTPServer(("127.0.0.1", candidate_port), handler)',
    'BoundedThreadingHTTPServer(("0.0.0.0", candidate_port), handler)'
)
path.write_text(text, encoding="utf-8")
PY

EXPOSE 8223

CMD ["python", "scripts/run_local_server.py"]
