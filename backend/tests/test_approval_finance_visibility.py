"""Synthetic, isolated checks of all three cadres and both approval channels."""
from datetime import date, timedelta

import pytest

from backend.models import Staff, StaffAssignment, User, UserReviewCadre, UserScope, WorkLogEntry
from .conftest import category_id
from .test_ctc_facility_approval import no_provider_sms
from .test_v22_finance import v22


def prepare(api, db, period, v22, provider, kind, historical_pricing=True):
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == provider).one()
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    # Test-only reviewer assignments; never broaden real account permissions.
    for username in (v22["finance"], "tofficer1", "fhifin1", "csofin1"):
        actor = db.query(User).filter_by(username=username).one()
        if not db.query(UserReviewCadre).filter_by(user_id=actor.id, cadre_id=staff.cadre_id).first():
            db.add(UserReviewCadre(user_id=actor.id, cadre_id=staff.cadre_id))
        if not db.query(UserScope).filter_by(user_id=actor.id, region_id=assignment.region_id).first():
            db.add(UserScope(user_id=actor.id, region_id=assignment.region_id))
    db.commit()
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": kind})
    if kind == "SERVICES":
        activity = api.post("/rates", "tofficer1", {
            "cadre_id": staff.cadre_id, "region_id": assignment.region_id,
            "label_en": "Isolated routing check", "label_sw": "Jaribio la uelekezaji",
            "item_type": kind, "form_mode": "SINGLE", "rate_value": 100,
            "unit_type": "PER_DAY", "effective_start_date": period["start_date"],
        })
        keys = [field["key"] for field in activity["field_definitions"]]
    else:
        activity = next(item for item in log["cadre"]["activities"] if item["key"] != "daily_attendance")
        keys = activity["required_fields"]
    day = date.fromisoformat(period["start_date"])
    if day.weekday() == 6:
        day += timedelta(days=1)
    values = {key: (False if next((field.get("field_type") for field in activity["field_definitions"] if field["key"] == key), None) == "BOOLEAN" else 1) for key in keys}
    log = api.put(f"/worklogs/{log['id']}/entries/{day}", provider, {
        "activity_key": activity["key"], "hours_worked": 4,
        "start_time": "08:00", "end_time": "12:00", "measures": values,
    })
    if kind == "PAYROLL" and historical_pricing:
        # Model a pre-existing priced snapshot, not a new Payroll-rate UI.
        entry = db.query(WorkLogEntry).filter_by(work_log_id=log["id"]).one()
        entry.activity_snapshot = {**entry.activity_snapshot, "rate_value": "25", "unit_type": "PER_HOUR"}
        db.commit()
    return api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": True})


def approve_to_regional_finance(api, log, finance_user):
    kind, other = log["work_type"], "PAYROLL" if log["work_type"] == "SERVICES" else "SERVICES"
    body = {"review_confirmed": True, "review_type": kind}
    for username, action, next_status in (
        ("supervisor1", "verify", "PENDING_TECHNICAL_REVIEW"),
        ("tofficer1", "endorse", "PENDING_RPM_AUTHORIZATION"),
        ("rpm1", "authorize", "PENDING_FINANCE_REVIEW"),
    ):
        assert log["id"] in {row["id"] for row in api.get(f"/worklogs?queue=true&work_type={kind}", username)}
        assert log["id"] not in {row["id"] for row in api.get(f"/worklogs?queue=true&work_type={other}", username)}
        api.post(f"/worklogs/{log['id']}/actions/{action}", username, {**body, "review_type": other}, expect=422)
        log = api.post(f"/worklogs/{log['id']}/actions/{action}", username, body)
        assert log["status"] == next_status
    queue = api.get(f"/finance/pending-routing?work_type={kind}", finance_user)
    row = next(row for row in queue if row["work_log_id"] == log["id"])
    assert row["finance_review_required"] and row["next_action"] == "REVIEW_AMOUNT"
    assert row["provider_name"] and row["period_label"] and row["cadre_name"] and row["region_name"]
    assert log["id"] not in {row["work_log_id"] for row in api.get(f"/finance/pending-routing?work_type={other}", finance_user)}
    return log


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
@pytest.mark.parametrize("kind", ["SERVICES", "PAYROLL"])
def test_separate_queues_and_correct_finance_payment_visibility(api, db, period, v22, provider, kind):
    log = approve_to_regional_finance(api, prepare(api, db, period, v22, provider, kind), v22["finance"])
    body = {"review_confirmed": True, "review_type": kind, "category_id": category_id(db, "A" if kind == "SERVICES" else "B")}
    reviewed = api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"], body)
    assert reviewed["status"] == "FINANCE_REVIEWED"
    routed = api.post("/finance/channel", v22["finance"], {
        "work_log_id": log["id"], "target_payor_id": reviewed["finance_snapshot"]["payor_org_id"],
        "review_confirmed": True, "review_type": kind, "expected_version": reviewed["version"],
    })
    assert routed["status"] == ("ROUTED_FHI360" if kind == "SERVICES" else "ROUTED_CSO")
    payer = "fhifin1" if kind == "SERVICES" else "csofin1"
    wrong_payer = "csofin1" if kind == "SERVICES" else "fhifin1"
    claim = api.get(f"/claims/{routed['claim_id']}", payer)
    assert claim["status"] == "READY" and claim["payment_status"] == "NOT_STARTED"
    assert "record_payment" in claim["payment_actions"]
    assert not claim["audit"]
    api.get(f"/claims/{claim['id']}", wrong_payer, expect=404)
    assert not any(row["work_log_id"] == log["id"] for row in api.get("/finance/pending-routing", v22["finance"]))


def test_unpriced_payroll_reaches_finance_but_cannot_be_routed_as_paid(api, db, period, v22):
    log = approve_to_regional_finance(api, prepare(api, db, period, v22, "chw1", "PAYROLL", historical_pricing=False), v22["finance"])
    api.post(f"/worklogs/{log['id']}/actions/finance_review", v22["finance"], {
        "review_confirmed": True, "review_type": "PAYROLL", "category_id": category_id(db, "B"),
    }, expect=422)
    assert api.get(f"/worklogs/{log['id']}", v22["finance"])["status"] == "PENDING_FINANCE_REVIEW"
