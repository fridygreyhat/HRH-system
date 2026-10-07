"""Sign-in protection: lockout, audit, temporary passwords and session invalidation."""
import itertools

from sqlalchemy import text

_n = itertools.count()


def _new_user(api, password="Temp-pass-1"):
    n = next(_n)
    return api.post("/admin/users", "admin", {"username": f"authuser{n}", "password": password, "full_name": f"Auth User {n}",
                                             "phone": f"+25579910{n:04d}", "roles": ["OVERSIGHT"]})


def _login(client, username, password):
    return client.post("/auth/login", data={"username": username, "password": password})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_lockout_after_repeated_failures_and_admin_unlock(api, client, db):
    user = _new_user(api)
    for _ in range(5):
        r = _login(client, user["username"], "wrong-password")
        assert r.status_code == 400 and r.json()["detail"] == "Incorrect username or password"
    r = _login(client, user["username"], "Temp-pass-1")  # correct password, but locked
    assert r.status_code == 429 and "Try again" in r.json()["detail"]
    assert api.get("/admin/users", "admin") and next(u for u in api.get("/admin/users", "admin") if u["id"] == user["id"])["is_locked"]
    api.post(f"/admin/users/{user['id']}/unlock", "admin")
    assert _login(client, user["username"], "Temp-pass-1").status_code == 200
    actions = [a for (a,) in db.execute(text("select action from audit_events where entity_type = 'auth' and entity_id = :i order by id"), {"i": str(user["id"])})]
    assert actions.count("login_failed") == 5 and "login_blocked" in actions and actions[-1] == "login_success"


def test_unknown_user_gets_the_same_answer(client, db):
    r = _login(client, "nobody-here", "whatever1")
    assert r.status_code == 400 and r.json()["detail"] == "Incorrect username or password"
    assert db.execute(text("select count(*) from audit_events where action = 'login_failed' and after->>'username' = 'nobody-here'")).scalar() == 1


def test_temporary_password_must_be_changed_first(api, client):
    user = _new_user(api)
    r = _login(client, user["username"], "Temp-pass-1")
    assert r.status_code == 200 and r.json()["must_change_password"] is True
    temp = r.json()["access_token"]
    assert client.get("/dashboard", headers=_auth(temp)).status_code == 403
    assert client.get("/auth/me", headers=_auth(temp)).json()["must_change_password"] is True
    assert client.post("/auth/change-password", headers=_auth(temp), json={"current_password": "nope", "new_password": "New-pass-123"}).status_code == 400
    assert client.post("/auth/change-password", headers=_auth(temp), json={"current_password": "Temp-pass-1", "new_password": "Temp-pass-1"}).status_code == 422
    r = client.post("/auth/change-password", headers=_auth(temp), json={"current_password": "Temp-pass-1", "new_password": "New-pass-123"})
    assert r.status_code == 200
    fresh = r.json()["access_token"]
    assert client.get("/dashboard", headers=_auth(fresh)).status_code == 200
    assert client.get("/auth/me", headers=_auth(temp)).status_code == 401  # the old session ended


def test_admin_reset_ends_sessions_and_requires_a_new_password(api, client):
    user = _new_user(api)
    first = _login(client, user["username"], "Temp-pass-1").json()["access_token"]
    token = client.post("/auth/change-password", headers=_auth(first), json={"current_password": "Temp-pass-1", "new_password": "Own-pass-123"}).json()["access_token"]
    assert client.get("/dashboard", headers=_auth(token)).status_code == 200
    api.post(f"/admin/users/{user['id']}/reset-password", "admin", {"new_password": "Reset-pass-9"}, expect=204)
    assert client.get("/dashboard", headers=_auth(token)).status_code == 401
    again = _login(client, user["username"], "Reset-pass-9").json()
    assert again["must_change_password"] is True


def test_deactivated_users_lose_access(api, client):
    user = _new_user(api)
    token = _login(client, user["username"], "Temp-pass-1").json()["access_token"]
    api.post(f"/admin/users/{user['id']}/deactivate", "admin")
    assert client.get("/auth/me", headers=_auth(token)).status_code == 401
    assert _login(client, user["username"], "Temp-pass-1").status_code == 400
