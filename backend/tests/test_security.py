"""Security fixes from the October 2026 review: sessions, separation of duties, scoping, exports and inputs."""
import json

from sqlalchemy import text

from .conftest import PASSWORD, category_id, submit_and_verify


def _login(api, username, password=PASSWORD):
    r = api.client.post("/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _new_user(api, username, phone):
    user = api.post("/admin/users", "admin", {"username": username, "password": PASSWORD, "full_name": username, "phone": phone, "roles": ["OVERSIGHT"]})
    from backend.db.session import SessionLocal
    from backend.models import User

    with SessionLocal() as s:  # skip the first-sign-in password change for this test account
        s.query(User).filter(User.id == user["id"]).update({User.must_change_password: False})
        s.commit()
    return user


def test_sign_out_ends_the_session_on_the_server(api):
    _new_user(api, "sec.logout", "+255719000001")
    headers = _login(api, "sec.logout")
    assert api.client.get("/auth/me", headers=headers).status_code == 200
    assert api.client.post("/auth/logout", headers=headers).status_code == 204
    assert api.client.get("/auth/me", headers=headers).status_code == 401  # the old token no longer works


def test_guessing_the_current_password_locks_the_account(api):
    _new_user(api, "sec.guess", "+255719000002")
    headers = _login(api, "sec.guess")
    for _ in range(5):
        r = api.client.post("/auth/change-password", json={"current_password": "wrong-guess", "new_password": "Another#Pass1"}, headers=headers)
        assert r.status_code in (400, 401)
    assert api.client.get("/auth/me", headers=headers).status_code == 401  # the session ended on lockout
    assert api.client.post("/auth/login", data={"username": "sec.guess", "password": PASSWORD}).status_code == 429


def test_nobody_changes_their_own_access(api):
    me = next(u for u in api.get("/admin/users", "admin") if u["username"] == "admin")
    api.put(f"/admin/users/{me['id']}/scopes", "admin", {"scopes": [{"region_id": 1}], "reason": "self"}, expect=422)
    api.put(f"/admin/users/{me['id']}/review-cadres", "admin", {"cadre_ids": [1], "reason": "self"}, expect=422)
    api.put("/admin/settings/login_max_failures", "admin", {"value": 1000, "reason": "turn lockout off"}, expect=422)
    api.put("/admin/settings/otp_length", "admin", {"value": 1, "reason": "trivial codes"}, expect=422)


def test_one_person_cannot_take_several_approval_steps(api, period):
    log = submit_and_verify(api, "chw1", period, supervisor="admin")  # a super admin holds every reviewer role
    api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})
    r = api.client.post(f"/worklogs/{log['id']}/actions/endorse", json={}, headers={"Authorization": f"Bearer {api.token('admin')}"})
    assert r.status_code in (403, 409) and "different person" in r.json()["detail"]
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", {})


def test_payment_details_change_only_with_a_second_admin(api, db):
    from backend.models import Staff

    staff = db.query(Staff).filter(Staff.verified_phone == "+255710000101").one()
    before = staff.payment_account
    r = api.call("PATCH", f"/staff/{staff.id}", "central1", json={"changes": {"payment_account": "9988776655"}, "reason": "New wallet"})
    assert not r["applied"] and r["change_request_id"]
    db.refresh(staff)
    assert staff.payment_account == before  # nothing changed yet
    api.post(f"/staff/change-requests/{r['change_request_id']}/decide", "central1", {"approve": True}, expect=403)
    api.post(f"/staff/change-requests/{r['change_request_id']}/decide", "regadmin1", {"approve": True})
    db.refresh(staff)
    assert staff.payment_account == "9988776655"
    logged = [json.dumps(row) for (row,) in db.execute(text("select after from audit_events where entity_type in ('staff', 'staff_change_request')"))]
    assert not any("9988776655" in row for row in logged)  # the audit log keeps only the last digits


def test_regional_admin_cannot_pull_staff_from_another_region(api):
    csv_text = "first_name,last_name,phone,cadre,region,start_date\nDaudi,Mbwambo,+255710000104,HCP,Iringa,2026-09-01\n"
    result = api.call("POST", "/staff/import", "regadmin1", files={"file": ("r.csv", csv_text, "text/csv")})
    assert result["updated_count"] == 0 and "outside your administrative region" in result["errors"][0]["error"]


def test_rate_rules_are_decided_in_scope(api, db):
    from backend.models import Region

    iringa = db.query(Region).filter(Region.name == "Iringa").one()
    body = {"category_id": category_id(db, "A"), "region_id": iringa.id, "component_name": "SEC regional", "unit_type": "FIXED",
            "rate_value": 1, "effective_start_date": "2020-01-01"}
    api.post("/admin/rate-rules", "csofin1", body, expect=403)  # CSOs never price FHI360 routes
    rule = api.post("/admin/rate-rules", "fhifin1", body)
    api.post(f"/admin/rate-rules/{rule['id']}/approve", "rpm2", expect=403)  # Njombe RPM, Iringa rate
    api.post(f"/admin/rate-rules/{rule['id']}/reject", "rpm1", {"comment": "test only"})


def test_exports_and_templates_cannot_carry_code():
    from backend.core.serialize import spreadsheet_safe

    assert spreadsheet_safe('=HYPERLINK("https://evil")') == '\'=HYPERLINK("https://evil")'
    assert spreadsheet_safe("@SUM(A1)").startswith("'") and spreadsheet_safe("-2+3").startswith("'")
    assert spreadsheet_safe("+255712345678") == "+255712345678" and spreadsheet_safe("Asha") == "Asha"


def test_sms_templates_reject_format_tricks(api):
    for bad in ("Hello {}", "HRH: {provider:>999999999}", "HRH: {provider!r} {period}", "HRH: {provider.__class__}"):
        api.post("/admin/sms-templates/preview", "rpm1", {"event_name": "WORKLOG_SUBMITTED", "language": "en", "template_text": bad}, expect=422)
