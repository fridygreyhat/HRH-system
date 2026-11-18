"""Deleting a user account: one never used goes completely; one with history leaves use but keeps its name there."""
import itertools

from backend.models import AuditEvent, Staff, User, UserRole, UserScope
from .test_bank_only_cadres import _staff

_phones = itertools.count(501)


def phone():
    return f"0755 125 {next(_phones):03d}"


def account(api, username, roles=("RPM",), staff=None):
    body = {"username": username, "password": "Strong-pass-123", "full_name": username.replace(".", " ").title(),
            "phone": staff["verified_phone"] if staff else phone(), "roles": list(roles),
            "scopes": [{"region_id": api.get("/admin/regions", "admin")[0]["id"]}] if not staff else []}
    if staff:
        body["staff"] = staff
    return api.call("POST", "/admin/users", "admin", json=body)


def delete(api, user, who="admin", confirmation=None, expect=None):
    return api.call("POST", f"/admin/users/{user['id']}/delete", who,
                    json={"confirmation": confirmation or user["username"], "reason": "Left the project"}, expect=expect)


def test_an_account_never_used_is_deleted_completely_and_its_username_can_be_used_again(api, db):
    user = account(api, "never.used")
    delete(api, user, confirmation="wrong.name", expect=422)  # the username must be typed exactly
    result = delete(api, user)
    assert result["completely"] is True
    assert db.get(User, user["id"]) is None
    assert not db.query(UserScope).filter_by(user_id=user["id"]).count()
    assert user["username"] not in {u["username"] for u in api.get("/admin/users", "admin")}
    event = db.query(AuditEvent).filter_by(entity_type="user", entity_id=str(user["id"]), action="delete").one()
    assert event.reason == "Left the project" and event.before["username"] == "never.used"
    account(api, "never.used")  # the username is free again


def test_an_account_with_history_leaves_use_but_keeps_its_name_in_that_history(api, db):
    user = account(api, "has.history")
    db.add(AuditEvent(actor_id=user["id"], actor_roles="RPM", entity_type="work_log", entity_id="1", action="authorize"))
    db.commit()  # the account approved something: the audit log names it, and that record is never changed
    result = delete(api, user)
    assert result["completely"] is False
    db.expire_all()
    row = db.get(User, user["id"])
    assert row.deleted_at and row.full_name == "Has History (deleted)" and not row.is_active
    assert row.username.startswith(f"deleted-{user['id']}-") and row.phone == f"deleted-{user['id']}"
    assert not db.query(UserRole).filter_by(user_id=user["id"]).count()
    assert "has.history" not in {u["username"] for u in api.get("/admin/users", "admin")}
    signin = api.client.post("/auth/login", data={"username": "has.history", "password": "Strong-pass-123"})
    assert signin.status_code in (400, 401)
    delete(api, user, expect=404)  # already deleted
    account(api, "has.history")  # the username and phone are free again


def test_deleting_a_provider_account_keeps_the_staff_record(api, db):
    staff = {**_staff(api, "CHW", phone(), "MOBILE_WALLET"), "tin_number": "300 400 501", "bank_name": "NMB",
             "bank_account_number": "0152278944"}
    user = account(api, "provider.leaving", roles=("PROVIDER",), staff=staff)
    staff_id = db.query(Staff.id).filter_by(user_id=user["id"]).scalar()
    result = delete(api, user)
    assert result["staff_id"] == staff_id
    db.expire_all()
    assert db.get(Staff, staff_id).user_id is None  # in the registry, without a login


def test_who_may_delete(api, db):
    user = account(api, "protected.one")
    for who in ("central1", "fhifin1", "supervisor1"):
        delete(api, user, who=who, expect=403)
    me = api.get("/auth/me", "admin")
    api.call("POST", f"/admin/users/{me['id']}/delete", "admin", json={"confirmation": "admin", "reason": "Not allowed"}, expect=422)
    delete(api, user)
