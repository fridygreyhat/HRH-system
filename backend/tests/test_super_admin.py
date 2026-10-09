"""The bootstrap administrator is a super administrator: every role, every page, no scope limit."""
from backend.models import User

from .conftest import PASSWORD, draft_log


def test_super_admin_holds_every_role(api):
    me = api.get("/auth/me", "admin")
    roles = {r["name"] for r in api.get("/admin/roles", "admin")}
    assert set(me["roles"]) == roles - {"PROVIDER"}
    # The Users screen shows the roles as granted, not the implied ones.
    admin = next(u for u in api.get("/admin/users", "admin") if u["username"] == "admin")
    assert set(admin["roles"]) == {"SYSTEM_ADMIN", "SUPER_ADMIN"}


def test_super_admin_acts_without_scopes(api, period):
    log = draft_log(api, "chw1", period)
    api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    assert any(w["id"] == log["id"] for w in api.get("/worklogs?queue=true", "admin"))
    api.post(f"/worklogs/{log['id']}/actions/verify", "admin", {"expected_version": log["version"]})


def test_only_a_super_admin_manages_super_admins(api, db):
    plain = api.post("/admin/users", "admin", {
        "username": "sysadmin2", "password": PASSWORD, "full_name": "Second Admin", "phone": "+255700222111", "roles": ["SYSTEM_ADMIN"],
    }, expect=201)
    db.query(User).filter(User.id == plain["id"]).update({User.must_change_password: False})  # skip the first-sign-in change
    db.commit()

    admin = next(u for u in api.get("/admin/users", "sysadmin2") if u["username"] == "admin")
    api.put(f"/admin/users/{plain['id']}/roles", "sysadmin2", {"roles": ["SYSTEM_ADMIN", "SUPER_ADMIN"], "reason": "self promotion"}, expect=403)
    api.post(f"/admin/users/{admin['id']}/reset-password", "sysadmin2", {"new_password": "Takeover-1"}, expect=403)
    api.post(f"/admin/users/{admin['id']}/deactivate", "sysadmin2", expect=403)

    api.put(f"/admin/users/{admin['id']}/roles", "admin", {"roles": ["SYSTEM_ADMIN"], "reason": "drop it"}, expect=422)
    promoted = api.put(f"/admin/users/{plain['id']}/roles", "admin", {"roles": ["SYSTEM_ADMIN", "SUPER_ADMIN"], "reason": "second super admin"})
    assert "SUPER_ADMIN" in promoted["roles"]
