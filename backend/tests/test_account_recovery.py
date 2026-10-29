"""Recovery checks run only in the isolated test database."""
from datetime import timedelta

from sqlalchemy import text

from backend.core.security import create_access_token, verify_password
from backend.models import User, utcnow


def test_failed_login_reasons_are_super_admin_only(api, client):
    user = api.post("/admin/users", "admin", {
        "username": "recovery.failure", "password": "Recovery-test-682",
        "full_name": "Recovery test", "phone": "+255799998101", "roles": ["OVERSIGHT"],
    })
    client.post("/auth/login", data={"username": user["username"], "password": "Wrong-test-682"})
    client.post("/auth/login", data={"username": "recovery.missing", "password": "Wrong-test-682"})
    rows = api.get("/admin/login-failures", "admin")
    assert any(row["username"] == user["username"] and row["reason"] == "bad_password" for row in rows)
    assert any(row["username"] == "recovery.missing" and row["reason"] == "unknown_user" for row in rows)
    filtered = api.get("/admin/login-failures?username=recovery.failure", "admin")
    assert filtered and all(row["username"] == user["username"] for row in filtered)
    for _ in range(4):
        client.post("/auth/login", data={"username": user["username"], "password": "Wrong-test-682"})
    client.post("/auth/login", data={"username": user["username"], "password": "Recovery-test-682"})
    assert api.get("/admin/login-failures?username=recovery.failure", "admin")[0]["reason"] == "locked"
    api.post(f"/admin/users/{user['id']}/deactivate", "admin")
    api.post(f"/admin/users/{user['id']}/unlock", "admin")
    client.post("/auth/login", data={"username": user["username"], "password": "Recovery-test-682"})
    assert api.get("/admin/login-failures?username=recovery.failure", "admin")[0]["reason"] == "inactive"
    for role in ("supervisor1", "tofficer1", "fhifin1", "central1"):
        api.get("/admin/login-failures", role, expect=403)
        api.post("/admin/user-password-reset", role, {
            "new_password": "Temporary-test-947", "confirmation": "RESET NON-SUPER-ADMIN PASSWORDS",
            "expected_count": 0, "reason": "Testing access restrictions",
        }, expect=403)
    assert "Recovery-test-682" not in str(rows) and "Wrong-test-682" not in str(rows)


def test_bulk_reset_preserves_all_super_admins_and_revokes_other_sessions(api, client, db):
    extra = api.post("/admin/users", "admin", {
        "username": "recovery.super", "password": "Protected-test-682",
        "full_name": "Protected test", "phone": "+255799998102", "roles": ["SUPER_ADMIN"],
    })
    target = db.query(User).filter_by(username="clerk1").one()
    old_token = create_access_token(target)
    protected_ids = set(db.execute(text(
        "select ur.user_id from user_roles ur join roles r on r.id=ur.role_id where r.name='SUPER_ADMIN'"
    )).scalars())
    assert extra["id"] in protected_ids and len(protected_ids) >= 2
    db.commit()
    keys = ("hashed_password", "must_change_password", "password_changed_at", "failed_login_count", "locked_until", "is_active")
    snapshot = {user.id: {key: getattr(user, key) for key in keys} for user in db.query(User).all()}
    # Restore the real pre-test state, not the synthetic lockout, on teardown.
    target.failed_login_count = 4
    target.locked_until = utcnow() + timedelta(hours=1)
    db.commit()
    count = len(snapshot) - len(protected_ids)
    body = {"new_password": "Temporary-test-947", "confirmation": "RESET NON-SUPER-ADMIN PASSWORDS",
            "expected_count": count, "reason": "Recover accounts after sign-in failures"}
    try:
        api.post("/admin/user-password-reset", "admin", {**body, "confirmation": "wrong"}, expect=422)
        api.post("/admin/user-password-reset", "admin", {**body, "expected_count": count + 1}, expect=409)
        db.expire_all()
        assert all(user.hashed_password == snapshot[user.id]["hashed_password"] for user in db.query(User))
        result = api.post("/admin/user-password-reset", "admin", body)
        assert result == {"reset_count": count, "super_admins_unchanged": len(protected_ids)}
        db.expire_all()
        for user in db.query(User):
            if user.id in protected_ids:
                assert {key: getattr(user, key) for key in keys} == snapshot[user.id]
            else:
                assert user.hashed_password != snapshot[user.id]["hashed_password"]
                assert user.must_change_password and user.password_changed_at
                assert user.failed_login_count == 0 and user.locked_until is None
                assert user.is_active == snapshot[user.id]["is_active"]
        assert verify_password(body["new_password"], db.get(User, target.id).hashed_password)
        assert client.get("/auth/me", headers={"Authorization": f"Bearer {old_token}"}).status_code == 401
        signed_in = client.post("/auth/login", data={"username": "clerk1", "password": body["new_password"]})
        assert signed_in.status_code == 200 and signed_in.json()["must_change_password"]
        headers = {"Authorization": f"Bearer {signed_in.json()['access_token']}"}
        assert client.get("/worklogs", headers=headers).status_code == 403
        changed = client.post("/auth/change-password", headers=headers, json={
            "current_password": body["new_password"], "new_password": "Individual-test-983",
        })
        assert changed.status_code == 200
        assert body["new_password"] not in str(api.get("/admin/audit-events", "admin"))
    finally:
        db.rollback()
        for uid, values in snapshot.items():
            db.query(User).filter_by(id=uid).update(values)
        db.commit()
