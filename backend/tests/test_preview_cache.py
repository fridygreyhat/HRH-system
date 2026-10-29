"""HTML entry points must not keep users on superseded finance screens."""
import pytest
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
