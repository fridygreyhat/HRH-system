"""Exercise the same /api mount used by the compiled frontend, on a disposable DB."""
from fastapi.testclient import TestClient

from backend import replit_app
from .conftest import PASSWORD
from .test_auth import _new_user


def test_browser_mount_connects_login_database_worklogs_and_permissions(client):
    with TestClient(replit_app.app) as browser:
        health = browser.get("/api/health")
        assert health.status_code == 200
        assert health.json()["database"] == "connected"
        login = browser.post("/api/auth/login", data={
            "username": "chw1", "password": PASSWORD,
        })
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert browser.get("/api/auth/me", headers=headers).json()["username"] == "chw1"
        assert browser.get("/api/worklogs", headers=headers).status_code == 200
        assert browser.get("/api/admin/users", headers=headers).status_code == 403
        assert browser.get("/review").headers["content-type"].startswith("text/html")
        missing = browser.get("/api/not-a-real-endpoint", headers=headers)
        assert missing.status_code == 404
        assert missing.headers["content-type"].startswith("application/json")


def test_temporary_password_can_be_changed_through_browser_mount(api):
    user = _new_user(api)
    with TestClient(replit_app.app) as browser:
        login = browser.post("/api/auth/login", data={
            "username": user["username"], "password": "Temp-pass-1",
        })
        assert login.status_code == 200
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert browser.get("/api/auth/me", headers=headers).status_code == 200
        assert browser.get("/api/dashboard", headers=headers).status_code == 403
        change = browser.post("/api/auth/change-password", headers=headers, json={
            "current_password": "Temp-pass-1", "new_password": "Changed-Mount-123",
        })
        assert change.status_code == 200
        fresh = {"Authorization": f"Bearer {change.json()['access_token']}"}
        assert browser.get("/api/dashboard", headers=fresh).status_code == 200
        assert browser.get("/api/auth/me", headers=headers).status_code == 401
