"""Check the running preview without printing credentials or bearer tokens."""

import os

import httpx


def main():
    origin = "https://" + os.environ["REPLIT_DEV_DOMAIN"]
    with httpx.Client(base_url=origin, timeout=30) as client:
        assert client.get("/").status_code == 200
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json() == {"status": "healthy", "database": "connected"}
        assert client.get("/api/meta").status_code == 200
        assert client.get("/api/dashboard").status_code == 401
        assert client.get("/api/docs").status_code == 200
        login = client.post("/api/auth/login", data={
            "username": os.environ.get("ADMIN_USERNAME", "admin"),
            "password": os.environ["ADMIN_PASSWORD"],
        })
        assert login.status_code == 200, f"Sign-in returned HTTP {login.status_code}"
        session = login.json()
        headers = {"Authorization": "Bearer " + session["access_token"]}
        me = client.get("/api/auth/me", headers=headers)
        assert me.status_code == 200, f"Profile returned HTTP {me.status_code}"
        assert "SYSTEM_ADMIN" in me.json()["roles"]
        dashboard = client.get("/api/dashboard", headers=headers)
        expected = 403 if session["must_change_password"] else 200
        assert dashboard.status_code == expected
        if session["must_change_password"]:
            # An invalid current password must reach the endpoint, not be
            # rejected by the first-sign-in route guard.
            change = client.post("/api/auth/change-password", headers=headers, json={
                "current_password": "",
                "new_password": "InvalidCheckOnly@123",
            })
            assert change.status_code == 400
        assert client.get("/admin/users").status_code == 200
        assert client.get("/missing.js").status_code == 404
    print("PASS: frontend, database health, API docs, sign-in, profile, password-change routing, access controls and SPA routes.")


if __name__ == "__main__":
    main()
