"""Taxpayer Identification Number (TIN) of providers: 9 digits, one per person (required at registration: test_user_registration_types.py)."""
import io

from openpyxl import load_workbook

from backend.core.tin import mask_tin, tin_number
from backend.models import AuditEvent, Staff
from .test_bank_only_cadres import _staff


def test_tin_is_checked_and_kept_in_one_form():
    assert tin_number("123456789") == tin_number(" 123 456 789 ") == tin_number("123-456-789") == "123-456-789"
    assert tin_number(None) is None and tin_number("  ") is None  # not given
    for wrong in ("12345678", "1234567890", "12A-456-789"):
        try:
            tin_number(wrong)
            raise AssertionError(wrong)
        except ValueError as error:
            assert "9-digit" in str(error)
    assert mask_tin("123-456-789") == "***-***-789"


def test_registering_staff_takes_a_tin_that_no_one_else_has(api, db):
    with_tin = api.post("/staff", "central1", {**_staff(api, "CHW", "0755 123 501", "MOBILE_WALLET"), "tin_number": "100 200 301"}, expect=201)
    assert db.get(Staff, with_tin["id"]).tin_number == "100-200-301"
    assert api.get(f"/staff/{with_tin['id']}", "central1")["tin_number"] == "100-200-301"
    without = api.post("/staff", "central1", {**_staff(api, "CHW", "0755 123 502", "MOBILE_WALLET"), "tin_number": "100 200 399"}, expect=201)
    refused = api.post("/staff", "central1", {**_staff(api, "CHW", "0755 123 503", "MOBILE_WALLET"), "tin_number": "1234"}, expect=422)
    assert "9-digit" in str(refused)
    taken = api.post("/staff", "central1", {**_staff(api, "CHW", "0755 123 504", "MOBILE_WALLET"), "tin_number": "100200301"}, expect=409)
    assert "TIN" in str(taken)

    # An admin adds or corrects it later on the staff record, with a reason, and it is audited.
    api.call("PATCH", f"/staff/{without['id']}", "central1", {"changes": {"tin_number": "100-200-302"}, "reason": "TIN certificate seen"})
    db.expire_all()
    assert db.get(Staff, without["id"]).tin_number == "100-200-302"
    assert db.query(AuditEvent).filter_by(entity_type="staff", entity_id=str(without["id"]), action="update").count() >= 1
    api.call("PATCH", f"/staff/{without['id']}", "central1", {"changes": {"tin_number": "100-200-301"}, "reason": "typo"}, expect=409)
    api.call("PATCH", f"/staff/{without['id']}", "central1", {"changes": {"tin_number": "999"}, "reason": "typo"}, expect=422)


def test_new_user_registered_as_a_health_worker_keeps_the_tin(api, db):
    staff = {**_staff(api, "CHW", "0755 123 505", "MOBILE_WALLET"), "tin_number": "100-200-303"}
    user = api.post("/admin/users", "admin", {"username": "tin.worker", "password": "Strong-pass-123", "phone": "0755 123 505",
                                              "full_name": "Asha Komba", "roles": ["PROVIDER"], "staff": staff})
    assert db.query(Staff).filter_by(user_id=user["id"]).one().tin_number == "100-200-303"


def test_roster_import_takes_a_tin_column_and_fills_a_missing_one(api, db):
    head = "first_name,last_name,phone,tin_number,cadre,region,start_date\n"
    rows = ("Roster,Tin,0799 000 401,100 200 304,CHW,Iringa,2023-01-01\n"
            "Roster,NoTin,0799 000 402,,CHW,Iringa,2023-01-01\n"
            "Roster,BadTin,0799 000 403,12,CHW,Iringa,2023-01-01\n")
    result = api.call("POST", "/staff/import", "central1", files={"file": ("roster.csv", head + rows, "text/csv")}, expect=201)
    assert (result["created_count"], result["error_count"]) == (2, 1) and "9-digit" in result["errors"][0]["error"]
    assert db.query(Staff).filter_by(tin_number="100-200-304").one().last_name == "Tin"
    # The same person again with a TIN: filled in where it was missing; a different TIN is refused.
    again = api.call("POST", "/staff/import", "central1", files={"file": ("roster.csv", head + (
        "Roster,NoTin,0799 000 402,100 200 305,CHW,Iringa,2023-01-01\n"
        "Roster,Tin,0799 000 401,100 200 399,CHW,Iringa,2023-01-01\n"), "text/csv")}, expect=201)
    assert again["error_count"] == 1 and "different TIN" in again["errors"][0]["error"]
    db.expire_all()
    assert db.query(Staff).filter_by(verified_phone="+255799000402").one().tin_number == "100-200-305"
    template = load_workbook(io.BytesIO(api.client.get("/staff/import-template.xlsx",
                                                       headers={"Authorization": f"Bearer {api.token('central1')}"}).content))
    assert "tin_number" in [c.value for c in template.worksheets[0][1]]
