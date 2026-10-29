"""Serve the existing API and compiled React app from one Replit preview URL."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .main import app as api

BUILD_DIR = Path(__file__).resolve().parent.parent / "frontend" / "build"
HTML_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/api", api)
app.mount("/static", StaticFiles(directory=BUILD_DIR / "static"), name="static")


@app.middleware("http")
async def prevent_entry_point_caching(request, call_next):
    response = await call_next(request)
    # Content-hashed build assets can be reused; entry points and missing files
    # must be fetched again after publishing. API headers are set by the API.
    if not request.url.path.startswith(("/static/", "/api/")):
        response.headers.update(HTML_HEADERS)
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
