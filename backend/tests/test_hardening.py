"""Security and data-safety rules: sessions, exports, imports, closed drafts and refused input."""
import json
import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest

from .conftest import ENTRY, PASSWORD, approved_log, category_id, draft_log
from .test_claims import _batch_for, _ready

ROOT = Path(__file__).resolve().parents[2]
ROSTER = "first_name,last_name,phone,cadre,region,start_date\n"


def _login(api, username, password=PASSWORD):
    r = api.client.post("/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _new_user(api, db, username, phone):
    from backend.models import User

    user = api.post("/admin/users", "admin", {"username": username, "password": PASSWORD, "full_name": username, "phone": phone, "roles": ["OVERSIGHT"]})
    db.query(User).filter(User.id == user["id"]).update({User.must_change_password: False})
    db.commit()


def _chw(db):
    from backend.models import Staff, User

    return db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()


def _python(code, **env):
    clean = {k: v for k, v in os.environ.items() if k not in {"SECRET_KEY", "SESSION_SECRET", "ENABLE_API_DOCS"}}
    return subprocess.run([sys.executable, "-c", code], cwd=ROOT, env={**clean, **env}, capture_output=True, text=True)


# Configuration
@pytest.mark.parametrize("env", [{}, {"SECRET_KEY": "short"}, {"SECRET_KEY": "dev-insecure-secret-change-me-0123456789"},
                                 {"SECRET_KEY": "replace-with-at-least-32-random-characters"}])
def test_server_refuses_a_missing_or_published_signing_key(env):
    result = _python("import backend.core.config", **env)
    assert result.returncode != 0 and "SECRET_KEY must be set" in result.stderr


def test_session_secret_still_works_for_existing_deployments():
    assert _python("import backend.core.config", SESSION_SECRET="s" * 40).returncode == 0


def test_api_docs_are_off_unless_asked_for():
    code = "from backend.main import app; print(app.docs_url, app.openapi_url)"
    assert _python(code, SECRET_KEY="k" * 40).stdout.strip() == "None None"
    assert _python(code, SECRET_KEY="k" * 40, ENABLE_API_DOCS="true").stdout.strip() == "/docs /openapi.json"


@pytest.mark.parametrize("password", ["", "short", "admin12345"])
def test_first_admin_needs_a_real_password(client, password):
    from backend import seed as seed_module
    from backend.core import config
    from backend.db.session import SessionLocal

    with SessionLocal() as session, patch.object(config, "ADMIN_USERNAME", "first.admin"), patch.object(config, "ADMIN_PASSWORD", password):
        with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
            seed_module.seed(session)
        session.rollback()


# Sessions
def test_sign_out_ends_the_session_on_the_server(api, db):
    _new_user(api, db, "sec.logout", "+255719000001")
    headers = _login(api, "sec.logout")
    assert api.client.get("/auth/me", headers=headers).status_code == 200
    assert api.client.post("/auth/logout", headers=headers).status_code == 204
    assert api.client.get("/auth/me", headers=headers).status_code == 401


def test_guessing_the_current_password_locks_the_account(api, db):
    _new_user(api, db, "sec.guess", "+255719000002")
    headers = _login(api, "sec.guess")
    for _ in range(5):
        r = api.client.post("/auth/change-password", json={"current_password": "wrong-guess", "new_password": "Another#Pass1"}, headers=headers)
        assert r.status_code in (400, 401)
    assert api.client.get("/auth/me", headers=headers).status_code == 401
    assert api.client.post("/auth/login", data={"username": "sec.guess", "password": PASSWORD}).status_code == 429


def test_session_counter_is_not_shown_to_users(api):
    assert "session_version" not in api.get("/auth/me", "chw1")


# Exports
def test_spreadsheet_cells_cannot_carry_formulas():
    from backend.core.serialize import spreadsheet_safe

    assert spreadsheet_safe('=HYPERLINK("https://evil")') == '\'=HYPERLINK("https://evil")'
    assert spreadsheet_safe("  =1+1") == "'  =1+1"
    assert spreadsheet_safe("\t@SUM(A1)").startswith("'") and spreadsheet_safe("-2+3").startswith("'")
    assert spreadsheet_safe("+255712345678") == "+255712345678" and spreadsheet_safe("-5") == "-5"
    assert spreadsheet_safe("Asha") == "Asha" and spreadsheet_safe(12) == 12 and spreadsheet_safe("") == ""


def test_batch_files_escape_names():
    from types import SimpleNamespace

    from openpyxl import load_workbook

    from backend.services import batches

    line = {column: "" for column in batches.CSV_COLUMNS} | {"staff_name": "=cmd()", "phone": "+255712345678", "amount": "10"}
    assert "'=cmd()" in batches._csv([line]) and "+255712345678" in batches._csv([line])
    batch = SimpleNamespace(reference="B1", total_amount=10, currency="TZS", export_snapshot={"lines": [line]})
    sheet = load_workbook(BytesIO(batches.to_xlsx(batch))).active
    cell = sheet.cell(row=2, column=batches.CSV_COLUMNS.index("staff_name") + 1)
    assert cell.value == "'=cmd()" and cell.data_type == "s"


def test_budget_export_escapes_names(api, db, period):
    api.post("/budgets/lines", "fhifin1", {"code": "=EVIL", "name": "@name", "organization_id": 1, "category_id": category_id(db, "A"),
                                           "period_id": period["id"], "allocated_amount": 100}, expect=201)
    response = api.client.post(f"/budgets/tracker/export?period_id={period['id']}", headers={"Authorization": f"Bearer {api.token('fhifin1')}"})
    assert response.status_code == 200 and "'=EVIL,'@name" in response.text


# Audit
def test_payment_details_change_only_with_a_second_admin_and_stay_masked(api, db):
    from backend.models import AuditEvent, Staff

    staff = _chw(db)
    before = staff.payment_account
    result = api.call("PATCH", f"/staff/{staff.id}", "central1", json={"changes": {"payment_account": "1234567890"}, "reason": "New wallet"})
    assert result["applied"] is False and result["change_request_id"]
    db.expire_all()
    assert db.get(Staff, staff.id).payment_account == before  # nothing changed yet
    url = f"/staff/change-requests/{result['change_request_id']}/decide"
    api.post(url, "central1", {"approve": True}, expect=403)  # not by the person who asked
    assert db.get(Staff, staff.id).payment_account == before
    api.post(url, "regadmin1", {"approve": True})
    db.expire_all()
    assert db.get(Staff, staff.id).payment_account == "1234567890"
    event = db.query(AuditEvent).filter_by(entity_type="staff", entity_id=str(staff.id), action="update").order_by(AuditEvent.id.desc()).first()
    assert event.after["payment_account"] == "•••7890"


def test_admin_edit_saves_the_name_and_requests_the_rest(api, db):
    from backend.models import Staff

    staff = _chw(db)
    result = api.call("PATCH", f"/staff/{staff.id}", "central1", json={"changes": {"middle_name": "Split", "salary_scale": "TGS-Z"}, "reason": "Update"})
    assert result["applied"] is True and result["change_request_id"]
    db.expire_all()
    row = db.get(Staff, staff.id)
    assert row.middle_name == "Split" and row.salary_scale != "TGS-Z"


def test_regional_admin_sees_only_change_requests_for_their_region(api, db):
    from backend.models import Staff, StaffAssignment

    allowed = {row["region_id"] for row in api.get("/auth/me", "regadmin1")["scopes"] if row["region_id"]}
    outside = db.query(Staff).join(StaffAssignment, StaffAssignment.staff_id == Staff.id).filter(
        StaffAssignment.end_date.is_(None), StaffAssignment.region_id.notin_(allowed)).first()
    request = api.call("PATCH", f"/staff/{outside.id}", "central1", json={"changes": {"salary_scale": "TGS-Y"}, "reason": "Elsewhere"})["change_request_id"]
    assert request in {row["id"] for row in api.get("/staff/change-requests", "central1")}
    assert request not in {row["id"] for row in api.get("/staff/change-requests", "regadmin1")}
    api.post(f"/staff/change-requests/{request}/decide", "regadmin1", {"approve": True}, expect=403)


# Closed periods
def _set_period_status(api, period, status):
    row = {k: period[k] for k in ("start_date", "end_date", "period_label")}
    api.put(f"/admin/pay-periods/{period['id']}", "central1", {**row, "status": status})


def test_closed_period_freezes_a_draft_but_it_can_still_be_submitted(api, period):
    log = draft_log(api, "chw1", period)
    day = log["entries"][0]["entry_date"]
    _set_period_status(api, period, "CLOSED")
    url = f"/worklogs/{log['id']}"
    detail = api.get(url, "chw1")
    assert detail["can_edit"] is False and "submit" in detail["available_actions"]
    api.put(f"{url}/entries/{day}", "chw1", ENTRY["CHW"](day), expect=409)
    api.call("DELETE", f"{url}/entries/{day}", "chw1", expect=409)
    assert api.post(f"{url}/actions/submit", "chw1", {"attest": True})["status"] != "DRAFT"


def test_reopening_a_period_unfreezes_its_drafts(api, period):
    log = draft_log(api, "chw1", period)
    day = log["entries"][0]["entry_date"]
    _set_period_status(api, period, "CLOSED")
    _set_period_status(api, period, "OPEN")
    assert api.put(f"/worklogs/{log['id']}/entries/{day}", "chw1", ENTRY["CHW"](day))["can_edit"] is True


def test_a_log_returned_after_the_period_closed_can_be_corrected(api, period):
    log = draft_log(api, "chw1", period)
    day = log["entries"][0]["entry_date"]
    url = f"/worklogs/{log['id']}"
    api.post(f"{url}/actions/submit", "chw1", {"attest": True})
    _set_period_status(api, period, "CLOSED")
    api.post(f"{url}/actions/return", "supervisor1", {"comment": "Check the hours"})
    assert api.get(url, "chw1")["can_edit"] is True
    api.put(f"{url}/entries/{day}", "chw1", ENTRY["CHW"](day))


# Budget lines and categories
def test_all_region_budget_lines_cannot_repeat_a_code(api, db, period):
    line = {"code": "REG-DUP", "name": "Dup", "organization_id": 1, "category_id": category_id(db, "A"), "period_id": period["id"], "allocated_amount": 100}
    api.post("/budgets/lines", "fhifin1", line, expect=201)
    api.post("/budgets/lines", "fhifin1", line, expect=409)
    regions = api.get("/admin/regions", "fhifin1")
    api.post("/budgets/lines", "fhifin1", {**line, "region_id": regions[0]["id"]}, expect=201)


def test_form_types_are_saved_in_one_spelling(api):
    created = api.post("/admin/claim-categories", "fhifin1", {"name": "Normalized category", "form_type": " chw_pnp "}, expect=201)
    assert created["form_type"] == "CHW_PNP"


# Imports
def _roster(api, rows, user="central1"):
    return api.call("POST", "/staff/import", user, files={"file": ("roster.csv", ROSTER + rows, "text/csv")}, expect=201)


def test_roster_reports_bad_phones_and_keeps_good_rows(api):
    result = _roster(api, "Bad,Phone,not-a-phone,CHW,Iringa,2023-01-01\nGood,Phone,0799 000 101,CHW,Iringa,2023-01-01\n")
    assert (result["created_count"], result["error_count"]) == (1, 1)
    assert result["errors"][0]["line"] == 2 and "Phone" in result["errors"][0]["error"]


def test_roster_reports_over_long_and_empty_cells_per_row(api):
    result = _roster(api, f"{'n' * 150},Long,+255799000102,CHW,Iringa,2023-01-01\nShort\nGood,Row,+255799000103,CHW,Iringa,2023-01-01\n")
    assert (result["created_count"], result["error_count"]) == (1, 2)
    assert {"line": 2, "error": "A value is too long"} in result["errors"]


def test_tracker_reports_an_over_long_cell_per_row(api, db, period):
    from backend.models import ClaimCategory

    name = db.get(ClaimCategory, category_id(db, "A")).name
    head = "code,name,category,period_start,region,allocated_amount,external_ref\n"
    rows = f"REG-L1,{'n' * 300},{name},{period['start_date']},,10,\nREG-L2,Fine,{name},{period['start_date']},,10,\n"
    result = api.call("POST", "/budgets/tracker/import", "fhifin1", files={"file": ("t.csv", head + rows, "text/csv")})
    assert (result["success_count"], result["error_count"], result["sync_status"]) == (1, 1, "PARTIAL")


def test_oversized_import_files_are_refused(api):
    from backend.core import config

    with patch.object(config, "MAX_IMPORT_BYTES", 1024 * 1024):
        api.call("POST", "/staff/import", "central1", files={"file": ("big.csv", b"x" * (1024 * 1024 + 1), "text/csv")}, expect=413)


def test_malformed_csv_is_a_clear_error(api):
    field = "x" * 200_000  # over the csv module's field limit
    api.call("POST", "/staff/import", "central1", files={"file": ("bad.csv", ROSTER + f'"{field}",a,b,c,d,e\n', "text/csv")}, expect=422)


def test_regional_admin_cannot_pull_staff_from_another_region(api, db):
    from backend.models import Region, Staff, StaffAssignment

    allowed = {row["region_id"] for row in api.get("/auth/me", "regadmin1")["scopes"] if row["region_id"]}
    outside = db.query(Staff).join(StaffAssignment, StaffAssignment.staff_id == Staff.id).filter(
        StaffAssignment.end_date.is_(None), StaffAssignment.region_id.notin_(allowed)).first()
    region = db.get(Region, sorted(allowed)[0]).name
    result = _roster(api, f"Moved,Person,{outside.verified_phone},CHW,{region},2026-09-01\n", user="regadmin1")
    assert result["updated_count"] == 0 and "outside your administrative region" in result["errors"][0]["error"]


# Refused input
def test_negative_declared_units_are_refused(api, db, period):
    body = {"category_id": category_id(db, "C"), "staff_id": _chw(db).id, "period_id": period["id"], "evidence_text": "Outreach", "declared_units": {"days": -1}}
    api.post("/claims/preview", "csofin1", body, expect=422)
    api.post("/claims", "csofin1", body, expect=422)


def test_nul_characters_are_refused(api, client):
    assert client.post("/auth/login", data={"username": "a\x00b", "password": "x"}).status_code == 422
    api.get("/staff?search=%00", "central1", expect=422)


@pytest.mark.parametrize("path", ["/admin/sms-outbox?limit=-1", "/admin/audit-events?limit=0", "/admin/audit-events?limit=100000"])
def test_log_limits_are_bounded(api, path):
    api.get(path, "admin", expect=422)


def test_config_id_must_be_a_number(api):
    api.put("/admin/organizations/abc", "central1", {"name": "x", "type": "CSO", "is_active": True}, expect=404)


@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_measures_must_be_finite(api, client, period, value):
    log = draft_log(api, "clerk1", period, days=0)
    day = period["start_date"]
    entry = {"gps_lat": -7.77, "gps_lon": 35.69, "gps_accuracy_m": 20, **ENTRY["DATA_CLERK"](day)}
    key = next(k for k, v in entry["measures"].items() if not isinstance(v, bool))
    url = f"/worklogs/{log['id']}/entries/{day}"
    headers = {"Authorization": f"Bearer {api.token('clerk1')}", "Content-Type": "application/json"}
    response = client.put(url, content=json.dumps({**entry, "measures": {**entry["measures"], key: value}}), headers=headers)
    assert response.status_code == 422 and "whole number" in response.text
    assert client.put(url, content=json.dumps(entry), headers=headers).status_code == 200  # the same entry is fine with a real number


def test_an_older_wallet_on_file_does_not_block_other_staff_edits(api):
    staff_id = api.get("/auth/me", "hcp1")["staff"]["id"]
    assert api.get(f"/staff/{staff_id}", "central1")["payment_method"] == "MOBILE_WALLET"
    assert api.call("PATCH", f"/staff/{staff_id}", "central1", json={"changes": {"middle_name": "Edited"}, "reason": "Spelling"})["applied"] is True
    api.call("PATCH", f"/staff/{staff_id}", "central1", json={"changes": {"payment_method": "MOBILE_WALLET"}, "reason": "Still refused"}, expect=422)


def test_missing_proof_file_is_404(api, db, period):
    from backend.core import config
    from backend.models import PaymentProof

    log = approved_log(api, "clerk1", period)
    claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "B")})
    _ready(api, claim["id"], "fhifin1", "fhifin2")
    batch = _batch_for(api, "fhifin1", "B", claim["id"])
    api.post(f"/batches/{batch['id']}/hand-off", "fhifin1")
    api.post(f"/batches/{batch['id']}/receive", "csofin1")
    proof = api.call("POST", f"/claims/{claim['id']}/proofs", "csofin1", files={"file": ("p.pdf", b"%PDF-1.4 x", "application/pdf")})["proofs"][0]
    os.remove(os.path.join(config.UPLOAD_DIR, db.get(PaymentProof, proof["id"]).storage_key))
    api.get(f"/claims/{claim['id']}/proofs/{proof['id']}", "csofin1", expect=404)
