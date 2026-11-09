"""Printing a review list as one set: the same timesheets the list shows, one pay month, one request."""
import itertools

import pytest

from backend.core.period_dates import pay_month_of
from backend.models import AuditEvent, PayPeriod, WorkLog, WorkLogEntry, WorkLogAudit, User
from backend.services import print_batch
from .test_approval_route_access import PROVIDERS, route  # noqa: F401
from .test_finance_monthly_reports import all_cadres  # noqa: F401
from .test_v22_finance import v22  # noqa: F401

REVIEWERS = ["supervisor1", "tofficer1", "rpm1", "facilityic1", "admin"]


def with_day(db, log, hours=6):
    period = db.get(PayPeriod, log.period_id)
    db.add(WorkLogEntry(work_log_id=log.id, entry_date=period.start_date, hours_worked=hours, evidence_text="Print check",
                        activity_key="print_check", activity_snapshot={"key": "print_check", "label_en": "Print check"}))
    db.commit()
    return pay_month_of(period.start_date)


def ids(rows):
    return {row["id"] for row in rows}


@pytest.mark.parametrize("user", REVIEWERS)
def test_a_printout_holds_exactly_what_the_list_shows(api, db, route, user):  # noqa: F811
    stages = itertools.cycle(("PENDING_CTC_VERIFICATION", "PENDING_TECHNICAL_REVIEW", "PENDING_RPM_AUTHORIZATION", "PENDING_FINANCE_REVIEW"))
    logs = [route["log"](provider, kind, next(stages)) for provider in PROVIDERS for kind in ("SERVICES", "PAYROLL")]
    month = [with_day(db, log) for log in logs][0]
    for kind in ("SERVICES", "PAYROLL"):
        for queue in ("true", "false"):
            only = f"&period_id={logs[0].period_id}"  # other tests' records stay in the shared test database
            listed = ids(api.get(f"/worklogs?queue={queue}&work_type={kind}{only}", user))
            printed = api.get(f"/worklogs/print?queue={queue}&work_type={kind}&month={month}{only}", user)["logs"]
            assert ids(printed) == listed
            mine = {log.id for log in logs if log.work_type == kind}
            assert all(row["days"] == 1 for row in printed if row["id"] in mine)


def test_each_timesheet_carries_its_form_and_only_the_chosen_month(api, db, route):  # noqa: F811
    log = route["log"]("hcp1", "PAYROLL", "PENDING_CTC_VERIFICATION")
    month = with_day(db, log, hours=7)
    later = db.get(PayPeriod, log.period_id).start_date.replace(year=2097)
    db.add(WorkLogEntry(work_log_id=log.id, entry_date=later, hours_worked=3, evidence_text="Other month", activity_key="print_check"))
    db.commit()
    printed = next(row for row in api.get(f"/worklogs/print?work_type=PAYROLL&month={month}&period_id={log.period_id}", "supervisor1")["logs"] if row["id"] == log.id)
    assert [entry["entry_date"] for entry in printed["entries"]] == [str(db.get(PayPeriod, log.period_id).start_date)]
    assert printed["hours"] in (7, "7", "7.00", 7.0)
    assert printed["cadre"]["code"] == "HCP" and "fields" in printed["cadre"]
    assert printed["assignment"]["region"] and printed["staff"]["last_name"]
    assert "holidays" in printed["period"]


def test_signer_names_follow_the_single_print_view_rule(api, db, route):  # noqa: F811
    log = route["log"]("chw1", "SERVICES", "PENDING_TECHNICAL_REVIEW")
    month = with_day(db, log)
    actor = db.query(User).filter_by(username="supervisor1").one()
    db.add(WorkLogAudit(work_log_id=log.id, actor_id=actor.id, action="verify", old_status="PENDING_CTC_VERIFICATION",
                        new_status="PENDING_TECHNICAL_REVIEW", version=log.version))
    db.commit()
    reviewer = next(row for row in api.get(f"/worklogs/print?work_type=SERVICES&month={month}&period_id={log.period_id}", "tofficer1")["logs"] if row["id"] == log.id)
    administrator = next(row for row in api.get(f"/worklogs/print?work_type=SERVICES&month={month}&period_id={log.period_id}", "admin")["logs"] if row["id"] == log.id)
    assert reviewer["audit"] == []
    assert [(row["action"], row["actor_name"]) for row in administrator["audit"]] == [("verify", actor.full_name)]


def test_a_list_too_long_to_print_is_refused_and_printing_is_recorded(api, db, route, monkeypatch):  # noqa: F811
    first = route["log"]("chw1", "SERVICES", "PENDING_CTC_VERIFICATION")
    month = with_day(db, first)
    with_day(db, route["log"]("hcp1", "SERVICES", "PENDING_CTC_VERIFICATION"))
    only = f"&period_id={first.period_id}"
    before = db.query(AuditEvent).filter_by(action="print_batch").count()
    api.get(f"/worklogs/print?queue=true&work_type=SERVICES&month={month}{only}", "supervisor1")
    assert db.query(AuditEvent).filter_by(action="print_batch").count() == before + 1
    monkeypatch.setattr(print_batch, "LIMIT", 1)
    api.get(f"/worklogs/print?queue=true&work_type=SERVICES&month={month}{only}", "supervisor1", expect=422)


def test_a_month_is_required(api):
    api.get("/worklogs/print?work_type=SERVICES", "supervisor1", expect=422)
    api.get("/worklogs/print?work_type=SERVICES&month=2026-13", "supervisor1", expect=422)


def test_a_printed_timesheet_carries_only_what_the_paper_shows(api, db, route):  # noqa: F811
    log = route["log"]("chw1", "PAYROLL", "PENDING_CTC_VERIFICATION")
    period = db.get(PayPeriod, log.period_id)
    snapshot = {"key": "big", "label_en": "Big", "guidance": "x" * 5000,
                "additional_services": [{"activity": {"key": "extra", "label_en": "Extra service", "guidance": "y" * 2000},
                                         "measures": {"clients": 2}, "activity_location": "Ward office"}]}
    db.add(WorkLogEntry(work_log_id=log.id, entry_date=period.start_date, hours_worked=5, evidence_text="Size", activity_key="big",
                        activity_snapshot=snapshot))
    db.commit()
    printed = next(row for row in api.get(f"/worklogs/print?work_type=PAYROLL&month={pay_month_of(period.start_date)}&period_id={period.id}", "supervisor1")["logs"]
                   if row["id"] == log.id)
    assert printed["entries"][0]["activity_snapshot"] == {"additional_services": [
        {"activity": {"label_en": "Extra service"}, "measures": {"clients": 2}, "activity_location": "Ward office"}]}
    assert set(printed["cadre"]) == {"id", "code", "name", "form_title", "hours_mode", "requires_facility_endorsement", "fields", "activities"}
    assert all(set(item) == {"key", "label_en"} for item in printed["cadre"]["activities"])
