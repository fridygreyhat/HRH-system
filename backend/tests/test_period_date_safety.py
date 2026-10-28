from datetime import date

import pytest

from backend.core.security import load_current_user
from backend.models import PayPeriod, Staff, StaffAssignment, User, WorkLog
from backend.services import worklog_workflow as wf
from .test_date_corrections import add_day, new_staff, period_body


@pytest.mark.parametrize("start,end", [
    ("0206-10-01", "2026-10-31"),
    ("0943-07-01", "2026-10-31"),
    ("2025-01-01", "2026-12-31"),
    ("2026-10-31", "2026-10-01"),
    ("2026-10-01", "9999-12-31"),
])
def test_create_and_update_reject_mistyped_or_unbounded_periods(api, period, start, end):
    body = period_body(period, start_date=start, end_date=end)
    api.post("/admin/pay-periods", "admin", body, expect=422)
    api.put(f"/admin/pay-periods/{period['id']}", "admin", body, expect=422)


@pytest.mark.parametrize("cadre", ["CHW", "HCP", "DATA_CLERK"])
@pytest.mark.parametrize("kind", ["SERVICES", "PAYROLL"])
def test_legacy_bad_dates_are_bounded_and_reviews_recover_after_correction(api, db, period, cadre, kind):
    staff = new_staff(api, cadre, start=period["start_date"])
    day = date.fromisoformat(period["start_date"])
    log_id = add_day(db, staff["id"], period, day)
    log = db.get(WorkLog, log_id)
    log.work_type = kind
    log.workflow_version = 2
    log.status = "PENDING_CTC_VERIFICATION"
    stored_period = db.get(PayPeriod, period["id"])
    original_start = stored_period.start_date
    original_end = stored_period.end_date
    stored_period.start_date = date(206, original_start.month, 1)
    db.commit()

    detail = api.get(f"/worklogs/{log_id}", "admin")
    summary = detail["review_summary"]
    assert len(summary["months"]) == 1
    assert summary["months"][0]["month"] == day.strftime("%Y-%m")
    assert summary["months"][0]["days"] == 1
    assert float(summary["months"][0]["hours"]) == 4
    assert any(flag["code"] == "INVALID_PAY_PERIOD" for flag in summary["anomalies"])

    # Even if BOTH years were mistyped, preserve visibility of real workdays
    # instead of filtering them out using the corrupt period bounds.
    stored_period.end_date = date(206, original_end.month, original_end.day)
    db.commit()
    detail = api.get(f"/worklogs/{log_id}", "admin")
    assert detail["review_summary"]["months"][0]["month"] == day.strftime("%Y-%m")
    assert float(detail["review_summary"]["months"][0]["hours"]) == 4

    # Isolated policy checks as an all-scope reviewer; no authentication bypass,
    # approvals, notifications or payments are performed.
    current = load_current_user(db, db.query(User).filter_by(username="admin").one())
    current.unrestricted = True
    approval_transitions = [
        (status, action, role)
        for (status, action), (_, role) in wf.transitions_for(log).items()
        if action in {"verify", "endorse", "authorize", "finance_review", "route_cso", "route_fhi360"}
        and (not action.startswith("route_") or action == ("route_fhi360" if kind == "SERVICES" else "route_cso"))
    ]
    current.roles.update(role for _, _, role in approval_transitions)
    for status, action, _ in approval_transitions:
        log.status = status
        assert "four-digit year" in wf.check_action(db, current, log, action)

    stored_period.start_date = original_start
    stored_period.end_date = original_end
    db.commit()
    for status, action, _ in approval_transitions:
        log.status = status
        assert wf.check_action(db, current, log, action) is None
    db.commit()
    detail = api.get(f"/worklogs/{log_id}", "admin")
    assert len(detail["review_summary"]["months"]) == 1
    assert not any(flag["code"] == "INVALID_PAY_PERIOD" for flag in detail["review_summary"]["anomalies"])
    assert db.get(StaffAssignment, log.assignment_id).staff_id == staff["id"]


def test_invalid_empty_legacy_period_does_not_invent_empty_months(api, db, period):
    staff = new_staff(api, start=period["start_date"])
    placement = db.query(StaffAssignment).filter_by(staff_id=staff["id"]).one()
    log = WorkLog(staff_id=staff["id"], assignment_id=placement.id,
                  cadre_id=db.get(Staff, staff["id"]).cadre_id, period_id=period["id"], work_type="PAYROLL")
    db.add(log)
    db.get(PayPeriod, period["id"]).start_date = date(206, 10, 1)
    db.commit()
    detail = api.get(f"/worklogs/{log.id}", "admin")
    assert detail["review_summary"]["months"] == []
