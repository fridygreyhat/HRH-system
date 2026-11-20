"""Positions from the HRH cadre list within each cadre, and an HCP's facility staff type (Government or Project)."""
import io

from openpyxl import load_workbook

from backend.models import AuditEvent, Staff
from .test_bank_only_cadres import _staff
from .test_v22_finance import v22  # noqa: F401 (fixture)


def _cadre(api, code):
    return next(c for c in api.get("/admin/cadres", "admin") if c["code"] == code)


def test_each_cadre_offers_the_positions_on_the_hrh_cadre_list(api):
    assert _cadre(api, "CHW")["occupation_options"] == ["CHW (HIV + TB)", "CHW/CBHSCO Focal Person", "Other"]
    assert _cadre(api, "DATA_CLERK")["occupation_options"][:4] == [
        "Facility Data Clerk", "District Data Officer", "Data Intern", "Data Clerk (HVL Hub)"]
    hcp = _cadre(api, "HCP")["occupation_options"]
    for position in ("OPD Tester", "Clinical Officer", "Enrolled Nurse", "Medical/Health Attendant", "Laboratory Technician",
                     "Nurse", "Laboratory Scientist", "Assistant Nursing Officer", "PnP Facility HRH"):
        assert position in hcp


def test_an_hcp_is_registered_as_government_or_project_facility_staff(api, db):
    hcp = {**_staff(api, "HCP", "0755 300 601", "BANK"), "occupation": "Clinical Officer"}
    missing = api.post("/staff", "central1", {**hcp, "facility_staff_type": None}, expect=422)
    assert "Government facility staff or Project facility staff" in str(missing)
    api.post("/staff", "central1", {**hcp, "facility_staff_type": "PRIVATE"}, expect=422)
    created = api.post("/staff", "central1", {**hcp, "facility_staff_type": "project"}, expect=201)
    assert created["facility_staff_type"] == "PROJECT" and created["occupation"] == "Clinical Officer"
    assert api.get(f"/staff/{created['id']}", "central1")["facility_staff_type"] == "PROJECT"

    # Corrected on the staff record with a reason, and audited.
    saved = api.call("PATCH", f"/staff/{created['id']}", "central1",
                     {"changes": {"facility_staff_type": "GOVERNMENT"}, "reason": "Employed by the council"})
    assert saved["applied"] is True and saved["staff"]["facility_staff_type"] == "GOVERNMENT"
    assert db.query(AuditEvent).filter_by(entity_type="staff", entity_id=str(created["id"]), action="update").count() >= 1


def test_other_cadres_are_not_government_or_project_facility_staff(api, db):
    chw = {**_staff(api, "CHW", "0755 300 602", "MOBILE_WALLET"), "occupation": "CHW/CBHSCO Focal Person"}
    api.post("/staff", "central1", {**chw, "facility_staff_type": "PROJECT"}, expect=422)
    created = api.post("/staff", "central1", chw, expect=201)
    assert created["facility_staff_type"] is None
    api.call("PATCH", f"/staff/{created['id']}", "central1",
             {"changes": {"facility_staff_type": "GOVERNMENT"}, "reason": "wrong"}, expect=422)

    # Moving an HCP to another cadre clears the type once the change is approved.
    hcp = api.post("/staff", "central1", {**_staff(api, "HCP", "0755 300 603", "BANK"), "facility_staff_type": "GOVERNMENT"}, expect=201)
    asked = api.call("PATCH", f"/staff/{hcp['id']}", "central1",
                     {"changes": {"cadre_id": _cadre(api, "DATA_CLERK")["id"]}, "reason": "Now a data clerk"})
    api.post(f"/staff/change-requests/{asked['change_request_id']}/decide", "admin", {"approve": True})
    db.expire_all()
    assert db.get(Staff, hcp["id"]).facility_staff_type is None


def test_a_new_hcp_user_keeps_the_facility_staff_type(api, db):
    staff = {**_staff(api, "HCP", "0755 300 604", "BANK"), "occupation": "Enrolled Nurse", "facility_staff_type": "GOVERNMENT"}
    user = api.post("/admin/users", "admin", {"username": "gov.nurse", "password": "Strong-pass-123", "phone": "0755 300 604",
                                              "full_name": "Asha Komba", "roles": ["PROVIDER"], "staff": staff})
    record = db.query(Staff).filter_by(user_id=user["id"]).one()
    assert (record.occupation, record.facility_staff_type) == ("Enrolled Nurse", "GOVERNMENT")
    refused = {**staff, "verified_phone": "0755 300 605", "facility_staff_type": None}
    api.post("/admin/users", "admin", {"username": "no.type", "password": "Strong-pass-123", "phone": "0755 300 605",
                                       "full_name": "Asha Komba", "roles": ["PROVIDER"], "staff": refused}, expect=422)


def test_roster_import_reads_the_facility_staff_type(api, db):
    head = "first_name,last_name,phone,cadre,occupation,facility_staff_type,region,start_date,id_type,id_number\n"
    rows = ("Roster,Gov,0799 000 501,HCP,Nurse,Government facility staff,Iringa,2023-01-01,VOTER,T-1000-0799-501\n"
            "Roster,Proj,0799 000 502,HCP,OPD Tester,PROJECT,Iringa,2023-01-01,VOTER,T-1000-0799-502\n"
            "Roster,Clerk,0799 000 503,DATA_CLERK,Data Intern,PROJECT,Iringa,2023-01-01,VOTER,T-1000-0799-503\n")
    result = api.call("POST", "/staff/import", "central1", files={"file": ("roster.csv", head + rows, "text/csv")}, expect=201)
    assert (result["created_count"], result["error_count"]) == (2, 1) and "Only HCP" in result["errors"][0]["error"]
    types = {s.last_name: s.facility_staff_type for s in db.query(Staff).filter(Staff.first_name == "Roster", Staff.last_name.in_(["Gov", "Proj"]))}
    assert types == {"Gov": "GOVERNMENT", "Proj": "PROJECT"}
    template = load_workbook(io.BytesIO(api.client.get("/staff/import-template.xlsx",
                                                       headers={"Authorization": f"Bearer {api.token('central1')}"}).content))
    assert "facility_staff_type" in [c.value for c in template.worksheets[0][1]]


def test_a_timesheet_keeps_a_position_from_before_the_list_changed(api, db, period):
    from backend.models import WorkLog
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "PAYROLL"})
    db.get(WorkLog, log["id"]).occupation = "CHW"  # written when CHW had no list of positions
    db.commit()
    api.put(f"/worklogs/{log['id']}", "chw1", {"occupation": "CHW"})
    api.put(f"/worklogs/{log['id']}", "chw1", {"occupation": "Nurse"}, expect=422)
    assert api.put(f"/worklogs/{log['id']}", "chw1", {"occupation": "CHW (HIV + TB)"})["occupation"] == "CHW (HIV + TB)"


# ---- Government staff: Services only; HCP Services pay by facility staff type ----------------------------------------

def _set_type(db, username, value):
    from backend.models import User
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == username).one()
    staff.facility_staff_type = value
    db.commit()


def test_government_staff_register_without_tin_or_bank(api, db):
    gov = {**_staff(api, "HCP", "0755 300 606", "BANK"), "facility_staff_type": "GOVERNMENT",
           "tin_number": None, "bank_name": None, "bank_account_number": None}
    created = api.post("/staff", "central1", gov, expect=201)
    record = db.get(Staff, created["id"])
    assert (record.tin_number, record.bank_name, record.bank_account_number) == (None, None, None)
    project = {**gov, "verified_phone": "0755 300 607", "facility_staff_type": "PROJECT"}
    assert "TIN" in str(api.post("/staff", "central1", project, expect=422))


def test_government_staff_have_no_payroll_timesheet(api, db, period, v22):
    _set_type(db, "hcp1", "GOVERNMENT")
    try:
        refused = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "PAYROLL"}, expect=422)
        assert "Services only" in str(refused)
        api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "SERVICES"}, expect=201)
    finally:
        _set_type(db, "hcp1", "PROJECT")


def test_hcp_services_pay_a_daily_amount_by_facility_staff_type(api, db, period, v22):
    from datetime import date, timedelta
    from .test_fixed_daily_services import daily_rate, service_measures
    rates = [daily_rate(api, db, period, "hcp1", amount) for amount in (100, 250)]
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"], "work_type": "SERVICES"})
    day = period["start_date"]
    two = {"activity_key": rates[0]["key"], "hours_worked": 4, "start_time": "08:00", "end_time": "12:00",
           "measures": service_measures(rates[0]),
           "additional_services": [{"activity_key": rates[1]["key"], "measures": service_measures(rates[1])}]}
    saved = api.put(f"/worklogs/{log['id']}/entries/{day}", "hcp1", two)
    # Project staff: 10,000 for the day, once, whatever the service's own rate and however many services.
    assert float(saved["financial_preview"]["total"]) == 10000
    assert [line["rate_setting"] for line in saved["financial_preview"]["lines"]] == ["hcp_project_daily_rate"]
    next_day = str(date.fromisoformat(day) + timedelta(days=1))
    saved = api.put(f"/worklogs/{log['id']}/entries/{next_day}", "hcp1", {**two, "additional_services": []})
    assert float(saved["financial_preview"]["total"]) == 20000
    try:
        _set_type(db, "hcp1", "GOVERNMENT")
        assert float(api.get(f"/worklogs/{log['id']}", "hcp1")["financial_preview"]["total"]) == 80000
        _set_type(db, "hcp1", None)  # held until the type is set
        held = api.get(f"/worklogs/{log['id']}", "hcp1")["financial_preview"]
        assert float(held["total"]) == 0 and "Government facility staff or Project facility staff" in held["exceptions"][0]
        _set_type(db, "hcp1", "PROJECT")
        # The amounts are settings a super administrator can change, with a reason.
        api.call("PUT", "/admin/settings/hcp_project_daily_rate", "admin", {"value": 0, "reason": "zero"}, expect=422)
        api.call("PUT", "/admin/settings/hcp_project_daily_rate", "admin", {"value": 12000, "reason": "New rate"})
        assert float(api.get(f"/worklogs/{log['id']}", "hcp1")["financial_preview"]["total"]) == 24000
    finally:
        _set_type(db, "hcp1", "PROJECT")
        api.call("PUT", "/admin/settings/hcp_project_daily_rate", "admin", {"value": 10000, "reason": "Back to policy"})


def test_other_cadres_keep_their_service_rates(api, db, period, v22):
    from .test_fixed_daily_services import daily_rate, service_measures
    rate = daily_rate(api, db, period, "chw1", 250)
    log = api.post("/worklogs", "chw1", {"period_id": period["id"], "work_type": "SERVICES"})
    saved = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", {
        "activity_key": rate["key"], "hours_worked": 4, "start_time": "08:00", "end_time": "12:00",
        "measures": service_measures(rate)})
    assert float(saved["financial_preview"]["total"]) == 250
