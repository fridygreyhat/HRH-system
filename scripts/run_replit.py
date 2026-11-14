"""Run the existing API, React build and notification worker without Docker."""

import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
os.environ.setdefault("UPLOAD_DIR", str(ROOT / ".data" / "uploads"))

if not (ROOT / "frontend" / "build" / "index.html").exists():
    sys.exit("Frontend build missing. Run npm run build first.")
if not os.environ.get("DATABASE_URL"):
    sys.exit("DATABASE_URL is required.")
if not (os.environ.get("SECRET_KEY") or os.environ.get("SESSION_SECRET")):
    sys.exit("Set SECRET_KEY or SESSION_SECRET in Replit Secrets.")

children = []


def stop(*_args):
    for child in children:
        if child.poll() is None:
            child.terminate()
    for child in children:
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


signal.signal(signal.SIGTERM, lambda *_args: sys.exit(0))
signal.signal(signal.SIGINT, lambda *_args: sys.exit(0))

try:
    # Several server processes use every CPU core; one process could not keep up with a few hundred people at once.
    workers = os.environ.get("WEB_CONCURRENCY") or str(max(2, min(4, os.cpu_count() or 2)))
    children.append(subprocess.Popen([
        sys.executable, "-m", "uvicorn", "backend.replit_app:app",
        "--host", os.environ.get("HOST", "0.0.0.0"), "--port", "5000", "--workers", workers,
        # Behind the host's proxy, read the visitor's address from X-Forwarded-For, so the sign-in limit counts each
        # person and not the proxy. Set FORWARDED_ALLOW_IPS to the proxy's address (or * where only the proxy can connect).
        "--proxy-headers", "--forwarded-allow-ips", os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    ]))
    children.append(subprocess.Popen([sys.executable, "-m", "backend.worker"]))
    while all(child.poll() is None for child in children):
        time.sleep(1)
    sys.exit(next(child.returncode or 1 for child in children if child.poll() is not None))
finally:
    stop()
