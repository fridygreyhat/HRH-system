"""Date corrections must not discard work or change financial history."""
from datetime import date, timedelta
from itertools import count

import pytest

from backend.models import AuditEvent, Staff, StaffAssignment, WorkLog, WorkLogEntry

phones = count(700810001)


def new_staff(api, cadre="CHW", start="2026-09-01"):
    cadre_id = next(c["id"] for c in api.get("/admin/cadres", "admin") if c["code"] == cadre)
    region = api.get("/admin/regions", "admin")[0]["id"]
    return api.post("/staff", "admin", {
        "cadre_id": cadre_id, "first_name": "Date", "last_name": "Correction",
        "verified_phone": f"+255{next(phones)}", "employment_start_date": start,
        "assignment": {"region_id": region},
    }, expect=201)


def correction(api, staff_id, start, placement=False, actor="admin", expect=None):
    return api.call("PATCH", f"/staff/{staff_id}/start-date", actor, {
        "start_date": start, "update_initial_assignment": placement, "reason": "Correct registration date",
    }, expect=expect)


def period_body(period, **updates):
    return {**{key: period.get(key) for key in ("start_date", "end_date", "period_label", "status", "region_id")}, **updates}

def unfunded_period(api, period):
    # The shared period fixture deliberately creates budget lines. Create a
    # separate regional period to exercise truly unused / draft-only schedules.
    region_id = api.get("/admin/regions", "admin")[0]["id"]
    return api.post("/admin/pay-periods", "admin", period_body(period, region_id=region_id), expect=201)


def add_day(db, staff_id, period, day):
    staff = db.get(Staff, staff_id)
    assignment = db.query(StaffAssignment).filter_by(staff_id=staff_id).first()
    log = WorkLog(staff_id=staff_id, period_id=period["id"], assignment_id=assignment.id, cadre_id=staff.cadre_id)
    db.add(log)
    db.flush()
    db.add(WorkLogEntry(work_log_id=log.id, entry_date=day, hours_worked=4, evidence_text="Isolated date test"))
    db.commit()
    return log.id


@pytest.mark.parametrize("cadre", ["CHW", "HCP", "DATA_CLERK"])
def test_admin_corrects_start_and_explicit_initial_placement(api, db, cadre):
    staff = new_staff(api, cadre)
    correction(api, staff["id"], "2026-08-01", placement=True)
    db.expire_all()
    assert str(db.get(Staff, staff["id"]).employment_start_date) == "2026-08-01"
    assert str(db.query(StaffAssignment).filter_by(staff_id=staff["id"]).one().start_date) == "2026-08-01"
    event = db.query(AuditEvent).filter_by(entity_type="staff", entity_id=str(staff["id"]), action="correct_start_date").one()
    assert event.before["employment_start_date"] == "2026-09-01"
    assert event.after["initial_assignment_start"] == "2026-08-01"
    assert event.reason == "Correct registration date"


def test_employment_only_correction_preserves_placement(api, db):
    staff = new_staff(api)
    correction(api, staff["id"], "2026-08-01")
    db.expire_all()
    assert str(db.query(StaffAssignment).filter_by(staff_id=staff["id"]).one().start_date) == "2026-09-01"
    correction(api, staff["id"], "2026-10-01", expect=422)
    correction(api, staff["id"], "not-a-date", expect=422)
    correction(api, staff["id"], "2026-08-01", actor="chw1", expect=403)
    correction(api, staff["id"], "2026-08-01", actor="csofin1", expect=403)


def test_start_date_cannot_exclude_work_or_rewrite_submitted_placement(api, db, period):
    start = date.fromisoformat(period["start_date"])
    staff = new_staff(api, start=str(start))
    log_id = add_day(db, staff["id"], period, start + timedelta(days=1))
    correction(api, staff["id"], str(start + timedelta(days=2)), placement=True, expect=409)
    db.get(WorkLog, log_id).status = "PENDING_TECHNICAL_REVIEW"
    db.commit()
    correction(api, staff["id"], str(start - timedelta(days=1)), placement=True, expect=409)
    correction(api, staff["id"], str(start - timedelta(days=1)))
    db.expire_all()
    assert db.query(StaffAssignment).filter_by(staff_id=staff["id"]).one().start_date == start


def test_initial_date_cannot_cross_employment_end_or_later_rotation(api, db):
    staff = new_staff(api)
    first = db.query(StaffAssignment).filter_by(staff_id=staff["id"]).one()
    first.end_date = date(2026, 9, 10)
    second = StaffAssignment(staff_id=staff["id"], region_id=first.region_id, start_date=date(2026, 9, 11))
    db.add(second)
    db.get(Staff, staff["id"]).employment_end_date = date(2026, 9, 30)
    db.commit()
    correction(api, staff["id"], "2026-10-01", placement=True, expect=422)
    correction(api, staff["id"], "2026-09-11", placement=True, expect=422)
    correction(api, staff["id"], "2026-08-01", placement=True)
    db.refresh(second)
    assert second.start_date == date(2026, 9, 11)


def test_period_can_be_edited_after_creation(api, period):
    period = unfunded_period(api, period)
    start = date.fromisoformat(period["start_date"]) + timedelta(days=1)
    result = api.put(f"/admin/pay-periods/{period['id']}", "admin", period_body(
        period, start_date=str(start), period_label="Corrected dates",
    ))
    assert result["start_date"] == str(start)
    assert result["period_label"] == "Corrected dates"
    assert result["can_edit_dates"] is True


def test_draft_period_correction_retains_all_workdays(api, db, period):
    period = unfunded_period(api, period)
    start = date.fromisoformat(period["start_date"])
    staff = new_staff(api, start=str(start))
    log_id = add_day(db, staff["id"], period, start + timedelta(days=1))
    rejected = api.put(f"/admin/pay-periods/{period['id']}", "admin", period_body(
        period, start_date=str(start + timedelta(days=2)),
    ), expect=409)
    assert "saved workday" in rejected["detail"]
    result = api.put(f"/admin/pay-periods/{period['id']}", "admin", period_body(
        period, start_date=str(start + timedelta(days=1)), period_label="Draft correction",
    ))
    assert result["can_edit_dates"] is True
    assert db.query(WorkLogEntry).filter_by(work_log_id=log_id).count() == 1
    db.get(WorkLog, log_id).status = "PENDING_TECHNICAL_REVIEW"
    db.commit()
    rejected = api.put(f"/admin/pay-periods/{period['id']}", "admin", period_body(
        result, end_date=str(date.fromisoformat(result["end_date"]) + timedelta(days=1)),
    ), expect=409)
    assert "Submitted" in rejected["detail"]
    saved = api.put(f"/admin/pay-periods/{period['id']}", "admin", period_body(result, status="CLOSED"))
    assert saved["can_edit_dates"] is False
    assert "Submitted" in saved["date_lock_reason"]


def test_budget_dates_remain_protected_but_label_and_status_are_editable(api, period):
    rejected = api.put(f"/admin/pay-periods/{period['id']}", "admin", period_body(
        period, end_date=str(date.fromisoformat(period["end_date"]) + timedelta(days=1)),
    ), expect=409)
    assert "Budget lines" in rejected["detail"]
    result = api.put(f"/admin/pay-periods/{period['id']}", "admin", period_body(
        period, period_label="Funded period", status="CLOSED",
    ))
    assert result["period_label"] == "Funded period"
    assert result["status"] == "CLOSED"
    assert result["can_edit_dates"] is False
    assert "Budget lines" in result["date_lock_reason"]
