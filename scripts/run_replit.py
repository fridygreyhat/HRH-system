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
    children.append(subprocess.Popen([
        sys.executable, "-m", "uvicorn", "backend.replit_app:app",
        "--host", "0.0.0.0", "--port", "5000",
    ]))
    children.append(subprocess.Popen([sys.executable, "-m", "backend.worker"]))
    while all(child.poll() is None for child in children):
        time.sleep(1)
    sys.exit(next(child.returncode or 1 for child in children if child.poll() is not None))
finally:
    stop()
