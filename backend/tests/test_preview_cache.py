"""HTML entry points must not keep users on superseded finance screens."""
import pytest
from fastapi.testclient import TestClient
from backend import replit_app


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
