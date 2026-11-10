"""Serve the existing API and compiled React app from one Replit preview URL."""

import mimetypes
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .core import config
from .main import app as api

# Installable web app files: browsers expect these exact types.
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")

BUILD_DIR = Path(__file__).resolve().parent.parent / "frontend" / "build"
HTML_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

# Build files carry a content hash in their name, so a browser may keep them until the next build renames them.
STATIC_HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)
# Compressed because the app script and styles hold no user data (unlike API responses, see main.py). Over a slow
# link such as a port-forwarding tunnel this cuts the first load from about 830 KB to about 230 KB.
app.mount("/static", GZipMiddleware(StaticFiles(directory=BUILD_DIR / "static"), minimum_size=1024), name="static")


# nginx does these under Docker. This entry point has no nginx in front of it.
LOGIN_PATH, LOGIN_LIMIT, LOGIN_WINDOW_SECONDS = "/api/auth/login", 20, 60
MAX_BODY_BYTES = config.MAX_UPLOAD_BYTES + 1024 * 1024
SECURITY_HEADERS = {"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin"}
_login_attempts = defaultdict(deque)


def too_many_logins(client: str, now: float) -> bool:
    attempts = _login_attempts[client]
    while attempts and attempts[0] <= now - LOGIN_WINDOW_SECONDS:
        attempts.popleft()
    attempts.append(now)
    return len(attempts) > LOGIN_LIMIT


@app.middleware("http")
async def prevent_entry_point_caching(request, call_next):
    length = request.headers.get("content-length", "0")
    if length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse({"detail": "This upload is too large."}, status_code=413, headers=SECURITY_HEADERS)
    if request.method == "POST" and request.url.path == LOGIN_PATH and too_many_logins(request.client.host if request.client else "", time.monotonic()):
        return JSONResponse({"detail": "Too many sign-in attempts. Wait a minute and try again."}, status_code=429, headers=SECURITY_HEADERS)
    response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
    # Content-hashed build assets can be reused; entry points and missing files
    # must be fetched again after publishing. API headers are set by the API.
    if not request.url.path.startswith(("/static/", "/api/")):
        response.headers.update(HTML_HEADERS)
    elif request.url.path.startswith("/static/") and response.status_code in (200, 304):
        response.headers.update(STATIC_HEADERS)
    return response


@app.get("/{path:path}")
def frontend(path: str):
    requested = (BUILD_DIR / path).resolve()
    if not requested.is_relative_to(BUILD_DIR):
        raise HTTPException(status_code=404)
    if requested.is_file():
        return FileResponse(requested, headers=HTML_HEADERS if requested.suffix == ".html" else None)
    # Browser routes belong to React; missing asset requests should not return HTML.
    if Path(path).suffix:
        raise HTTPException(status_code=404)
    return FileResponse(BUILD_DIR / "index.html", headers=HTML_HEADERS)
