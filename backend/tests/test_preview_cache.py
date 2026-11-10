"""HTML entry points must not keep users on superseded finance screens."""
import pytest
from fastapi.testclient import TestClient
from backend import replit_app


def test_api_documentation_login_url_resolves_under_api_mount():
    with TestClient(replit_app.app) as client:
        schema = client.get("/api/openapi.json").json()
    scheme = schema["components"]["securitySchemes"]["OAuth2PasswordBearer"]
    assert scheme["flows"]["password"]["tokenUrl"] == "auth/login"
    assert {"url": "/api"} in schema["servers"]


@pytest.mark.parametrize("path", ["", "index.html", "finance-monthly"])
def test_preview_html_is_not_cached(monkeypatch, tmp_path, path):
    (tmp_path / "index.html").write_text("<html>Current application</html>")
    monkeypatch.setattr(replit_app, "BUILD_DIR", tmp_path)
    response = replit_app.frontend(path)
    assert "no-store" in response.headers["cache-control"]
    assert "must-revalidate" in response.headers["cache-control"]
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["expires"] == "0"


@pytest.mark.parametrize("path,status", [
    ("/", 200),
    ("/finance-monthly", 200),
    ("/missing.js", 404),
    ("/api/meta", 200),
    ("/api/dashboard", 401),
    ("/api/missing-route", 404),
])
def test_cache_protection_covers_api_errors_and_browser_routes(path, status):
    with TestClient(replit_app.app) as client:
        response = client.get(path)
    assert response.status_code == status
    assert "no-store" in response.headers["cache-control"]
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["expires"] == "0"


def test_build_assets_are_compressed_and_kept_but_missing_ones_are_not():
    from pathlib import Path
    asset = next((replit_app.BUILD_DIR / "static").glob("index-*.js"), None)
    if asset is None:
        pytest.skip("frontend build missing")
    with TestClient(replit_app.app) as client:
        response = client.get(f"/static/{asset.name}", headers={"Accept-Encoding": "gzip"})
        missing = client.get("/static/index-missing.js")
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert response.content == Path(asset).read_bytes()
    assert missing.status_code == 404
    assert "immutable" not in missing.headers.get("cache-control", "")


def test_api_responses_stay_uncompressed_below_the_large_list_threshold():
    with TestClient(replit_app.app) as client:
        meta = client.get("/api/meta", headers={"Accept-Encoding": "gzip"})
        login = client.post("/api/auth/login", data={"username": "nobody", "password": "wrong"},
                            headers={"Accept-Encoding": "gzip"})
    assert meta.status_code == 200 and login.status_code == 400
    assert "content-encoding" not in meta.headers
    assert "content-encoding" not in login.headers
    assert meta.headers["cache-control"] == "no-store"


def test_large_api_lists_are_still_compressed():
    from fastapi import FastAPI
    from fastapi.middleware.gzip import GZipMiddleware
    from backend import main
    gzip = next(m for m in main.app.user_middleware if m.cls is GZipMiddleware)
    # Innermost (added first), so it sees whole responses rather than the cache layer's stream.
    assert main.app.user_middleware[-1] is gzip
    probe = FastAPI()
    probe.add_middleware(GZipMiddleware, **gzip.kwargs)
    probe.get("/big")(lambda: {"rows": ["x" * 100] * 1000})
    with TestClient(probe) as client:
        assert client.get("/big", headers={"Accept-Encoding": "gzip"}).headers["content-encoding"] == "gzip"
