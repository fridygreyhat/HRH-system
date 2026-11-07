"""Each service states the least days a provider should work on it in a pay month. A shortfall is shown, never enforced."""
import itertools
import uuid
from datetime import timedelta

import pytest

from backend.core.period_dates import pay_month_range
from backend.models import PayPeriod, Staff, StaffAssignment, User, WorkLog, WorkLogEntry, utcnow
from backend.services import worklog_workflow
from backend.services.service_targets import monthly_minimums

_months = itertools.count(2)


def body(staff, placement, start, days, label=None):
    return {"label_en": label or f"Index {uuid.uuid4().hex[:8]}", "label_sw": "Huduma", "cadre_id": staff.cadre_id, "region_id": placement.region_id,
            "item_type": "SERVICES", "form_mode": "SINGLE", "unit_type": "PER_DAY", "rate_value": 20000, "currency": "TZS",
            "effective_start_date": str(start), "min_days_per_month": days}


@pytest.fixture
def month(api, db):
    """A pay month of its own, far ahead so no other test's service applies. Logs are cancelled, not deleted, as audits stay."""
    number = next(_months)
    start, end = pay_month_range(f"{2094 + number // 12}-{number % 12 + 1:02d}")
    period = PayPeriod(start_date=start, end_date=end, status="OPEN", period_label="Target check")
    db.add(period)
    db.commit()
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    placement = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()

    def service(days, label=None):
        return api.post("/rates", "tofficer1", body(staff, placement, start, days, label))

    def log(status="DRAFT", kind="SERVICES", in_period=period):
        row = WorkLog(staff_id=staff.id, assignment_id=placement.id, cadre_id=staff.cadre_id, period_id=in_period.id, workflow_version=2,
                      work_type=kind, status=status, attested_at=utcnow())
        db.add(row)
        db.commit()
        return row

    def worked(row, activity, days, extra=()):
        snapshot = {**activity, "required_fields": [], "additional_services": [{"activity": item, "measures": {}} for item in extra]}
        for day in days:
            db.add(WorkLogEntry(work_log_id=row.id, entry_date=day, hours_worked=2, evidence_text="Counts", activity_key=activity["key"], activity_snapshot=snapshot))
        db.commit()

    yield {"period": period, "start": start, "end": end, "service": service, "log": log, "worked": worked, "staff": staff, "placement": placement}
    db.rollback()
    db.query(WorkLog).filter_by(period_id=period.id).update({"status": "CANCELLED"})
    period.status = "ARCHIVED"
    db.commit()


def targets(api, log):
    return {row["service"]: row for row in api.get(f"/worklogs/{log.id}", "chw1")["service_targets"]}


def flags(api, log):
    return [flag["message"] for flag in api.get(f"/worklogs/{log.id}", "supervisor1")["review_summary"]["anomalies"] if flag["code"] == "SERVICE_MINIMUM_DAYS"]


@pytest.mark.parametrize("days,status", [(None, 422), (-1, 422), (32, 422), (0, 201), (31, 201)])
def test_adding_a_service_must_state_its_days(api, month, days, status):
    payload = body(month["staff"], month["placement"], month["start"], days)
    if days is None:
        del payload["min_days_per_month"]
    api.call("POST", "/rates", "tofficer1", json=payload, expect=status)


def test_a_revision_keeps_the_days_unless_changed(api, month):
    first = month["service"](10)
    kept = api.post(f"/rates/{first['id']}/revise", "tofficer1", {"rate_value": 25000, "effective_start_date": str(month["start"] + timedelta(days=1))})
    assert kept["min_days_per_month"] == 10
    changed = api.post(f"/rates/{kept['id']}/revise", "tofficer1", {"rate_value": 25000, "effective_start_date": str(month["start"] + timedelta(days=2)), "min_days_per_month": 12})
    assert changed["min_days_per_month"] == 12


def test_progress_counts_days_per_service_as_main_or_additional(api, month):
    index, sns = month["service"](10), month["service"](5)
    log = month["log"]()
    days = [month["start"] + timedelta(days=offset) for offset in range(4)]
    month["worked"](log, index, days[:3], extra=[sns])
    month["worked"](log, sns, days[3:])
    rows = targets(api, log)
    assert (rows[index["label_en"]]["days"], rows[index["label_en"]]["min_days"], rows[index["label_en"]]["left"]) == (3, 10, 7)
    assert (rows[sns["label_en"]]["days"], rows[sns["label_en"]]["left"]) == (4, 1)


def test_a_service_past_its_minimum_has_nothing_left(api, month):
    index = month["service"](2)
    log = month["log"]()
    month["worked"](log, index, [month["start"] + timedelta(days=offset) for offset in range(3)])
    row = targets(api, log)[index["label_en"]]
    assert (row["days"], row["left"]) == (3, 0)


def test_only_days_in_the_pay_month_count(api, month):
    index = month["service"](10)
    log = month["log"]()
    month["worked"](log, index, [month["end"], month["end"] + timedelta(days=1), month["start"] - timedelta(days=1)])
    assert targets(api, log)[index["label_en"]]["days"] == 1


def test_a_cancelled_timesheet_does_not_count(api, db, month):
    index = month["service"](10)
    other = PayPeriod(start_date=month["start"], end_date=month["start"] + timedelta(days=2), region_id=month["placement"].region_id, status="OPEN", period_label="Target other")
    db.add(other)
    db.commit()
    gone = month["log"]("CANCELLED", in_period=other)
    month["worked"](gone, index, [month["start"]])
    log = month["log"]()
    assert targets(api, log)[index["label_en"]]["days"] == 0
    other.status = "ARCHIVED"
    db.commit()


def test_a_revised_service_keeps_its_count_and_uses_the_newest_minimum(api, db, month):
    first = month["service"](10)
    revised = api.post(f"/rates/{first['id']}/revise", "tofficer1", {"rate_value": 30000, "effective_start_date": str(month["start"] + timedelta(days=2)), "min_days_per_month": 12})
    log = month["log"]()
    month["worked"](log, first, [month["start"]])
    month["worked"](log, revised, [month["start"] + timedelta(days=3)])
    row = targets(api, log)[first["label_en"]]
    assert (row["days"], row["min_days"]) == (2, 12)
    scope = (month["staff"].cadre_id, month["placement"].region_id)
    assert monthly_minimums(db, month["end"])[scope][first["label_en"]] == 12  # the payment report agrees


def test_no_minimum_means_no_row_and_payroll_has_none(api, month):
    free = month["service"](0)
    assert free["label_en"] not in targets(api, month["log"]())
    assert api.get(f"/worklogs/{month['log'](kind='PAYROLL').id}", "chw1")["service_targets"] == []


def test_reviewers_are_flagged_after_submission_not_during_the_month(api, db, month):
    index, done = month["service"](10), month["service"](1)
    log = month["log"]()
    month["worked"](log, index, [month["start"]])
    month["worked"](log, done, [month["start"] + timedelta(days=1)])
    assert not [flag for flag in api.get(f"/worklogs/{log.id}", "chw1")["review_summary"]["anomalies"] if flag["code"] == "SERVICE_MINIMUM_DAYS"]
    log.status = "PENDING_CTC_VERIFICATION"
    db.commit()
    messages = flags(api, log)
    assert f"{index['label_en']}: 1 of 10 minimum days this month." in messages
    assert not [message for message in messages if message.startswith(done["label_en"])]
    assert api.get(f"/worklogs/{log.id}", "supervisor1")["service_targets"]


def test_a_provider_below_the_minimum_is_still_paid_for_every_day(api, month):
    index = month["service"](10)
    log = month["log"]()
    weekday = month["start"] + timedelta(days=(7 - month["start"].weekday()) % 7)
    month["worked"](log, index, [weekday, weekday + timedelta(days=1)])
    assert targets(api, log)[index["label_en"]]["left"] == 8
    preview = api.get(f"/worklogs/{log.id}", "chw1")["financial_preview"]
    assert float(preview["total"]) == 40000 and len(preview["lines"]) == 2


@pytest.mark.parametrize("status", ["DRAFT", "RETURNED_TO_PROVIDER"])
def test_a_shortfall_does_not_stop_submission(api, monkeypatch, month, status):
    index = month["service"](10)
    log = month["log"](status)
    weekday = month["start"] + timedelta(days=(7 - month["start"].weekday()) % 7)  # Saturdays have their own hour rule
    month["worked"](log, index, [weekday])
    monkeypatch.setattr(worklog_workflow, "local_today", lambda: month["end"])
    assert api.post(f"/worklogs/{log.id}/actions/submit", "chw1", {"attest": True})["status"] == "PENDING_CTC_VERIFICATION"
