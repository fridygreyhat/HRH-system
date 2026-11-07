"""A pay month runs from the 26th to the 25th. One timesheet stays in one month, so a salary can never appear twice."""
from datetime import date, time, timedelta

import pytest

from backend.api.endpoints import pay_periods
from backend.core.period_dates import pay_month_of, pay_month_range
from backend.models import AuditEvent, PayPeriod, Staff, StaffAssignment, User, WorkLog, WorkLogEntry, WorkLogMeasure, utcnow
from backend.services import worklog_workflow
from backend.services.public_holidays import easter_sunday
from .conftest import make_period
from .test_finance_monthly_reports import all_cadres
from .test_salary_timesheets import approved_log, file_rows, provider_details, set_amount, sign, temporary
from .test_v22_finance import v22


@pytest.mark.parametrize("day,month", [
    (date(2026, 10, 25), "2026-10"), (date(2026, 10, 26), "2026-11"), (date(2026, 11, 25), "2026-11"),
    (date(2026, 12, 26), "2027-01"), (date(2027, 1, 1), "2027-01"), (date(2028, 2, 29), "2028-03"),
])
def test_a_date_belongs_to_the_month_that_ends_on_the_next_25th(day, month):
    assert pay_month_of(day) == month


def test_a_month_starts_on_the_26th_and_ends_on_the_25th():
    assert pay_month_range("2026-11") == (date(2026, 10, 26), date(2026, 11, 25))
    assert pay_month_range("2027-01") == (date(2026, 12, 26), date(2027, 1, 25))


_crossing = {}


@pytest.fixture
def crossing(api, db, v22):
    """A signed timesheet with work on 26 of the month before, in the month, on the 25th, and on the 26th after it."""
    first = not _crossing
    if first:
        all_cadres(db, v22["finance"])
        all_cadres(db, "csofin1")
        log, entry, placement = approved_log(db, make_period(api, db))
        entry.activity_snapshot = {**entry.activity_snapshot, "field_definitions": []}
        db.query(WorkLogMeasure).filter_by(entry_id=entry.id).delete()
        day = entry.entry_date
        before = (day.replace(day=1) - timedelta(days=1)).replace(day=26)

        def extra(when, hours):
            db.add(WorkLogEntry(work_log_id=log.id, entry_date=when, hours_worked=hours, evidence_text="Test",
                                activity_key=entry.activity_key, activity_snapshot=entry.activity_snapshot,
                                start_time=time(8, 0), end_time=time(16, 0)))

        extra(before, 7)
        db.flush()
        first_day = db.query(WorkLogEntry).filter_by(work_log_id=log.id, entry_date=before).one()
        db.add(WorkLogMeasure(entry_id=first_day.id, field_key="clients", value=2))
        extra(day.replace(day=25), 6)
        extra(day.replace(day=26), 3)
        db.commit()
        month = day.strftime("%Y-%m")
        query = f"cso_id={placement.organization_id}&month={month}"
        _crossing.update(month=month, log_id=log.id, staff_id=placement.staff_id, organization_id=placement.organization_id,
                         scale="SCALE-PAY-MONTH", summary=f"/cso-finance/salary-timesheets?{query}",
                         export=f"/cso-finance/salary-timesheets/export?{query}")
    with provider_details(db, _crossing) as state:
        if first:
            sign(api, v22, state["month"])
        yield state


def test_one_timesheet_is_one_month_in_the_salary_file(api, crossing):
    set_amount(api, crossing, "750000.00", crossing["month"])
    summary = api.get(crossing["summary"], "csofin1")
    assert summary["totals"]["salary"] == "750000.00"
    assert summary["providers"][0]["days_signed"] == 3
    row = file_rows(api, crossing)[0]
    assert row["Day 26"] == "7" and row["Day 25"] == "6"
    days = [name for name in row if name.startswith("Day ") and name[4:].isdigit()]
    assert days[0] == "Day 26" and days[-1] == "Day 25"


def test_reviewers_see_totals_by_pay_month(api, crossing):
    rows = {row["month"]: row for row in api.get(f"/worklogs/{crossing['log_id']}", "chw1")["review_summary"]["months"]}
    assert rows[crossing["month"]]["days"] == 3 and float(rows[crossing["month"]]["hours"]) == 21
    assert float(rows[crossing["month"]]["metrics"]["clients"]) == 2
    assert sum(row["days"] for row in rows.values()) == 4


@pytest.fixture
def waiting_log(db, temporary):
    """A provider's timesheet in a month that has not finished yet."""
    today = date.today()
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    placement = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    period = temporary(PayPeriod(start_date=today - timedelta(days=3), end_date=today + timedelta(days=3), status="OPEN", period_label="Waiting"))
    log = temporary(WorkLog(staff_id=staff.id, assignment_id=placement.id, cadre_id=staff.cadre_id, period_id=period.id,
                            workflow_version=2, work_type="PAYROLL", status="DRAFT", attested_at=utcnow()))
    temporary(WorkLogEntry(work_log_id=log.id, entry_date=today, hours_worked=8, evidence_text="Test", activity_key="waiting_test", activity_snapshot={
        "key": "waiting_test", "label_en": "Test", "label_sw": "Jaribio", "item_type": "PAYROLL", "form_mode": "SINGLE", "fields": [],
        "required_fields": [], "field_definitions": [], "rate_value": None, "currency": "TZS", "unit_type": "PER_DAY", "billable_field": None}))
    return log, period


def test_a_provider_cannot_submit_before_the_last_day(api, waiting_log):
    log, period = waiting_log
    assert "submit" not in api.get(f"/worklogs/{log.id}", "chw1")["available_actions"]
    response = api.client.post(f"/worklogs/{log.id}/actions/submit", json={"attest": True}, headers={"Authorization": f"Bearer {api.token('chw1')}"})
    assert response.status_code == 403 and "You can submit on" in response.json()["detail"]


def test_a_provider_can_submit_on_the_last_day_and_after(api, monkeypatch, waiting_log):
    log, period = waiting_log
    for today in (period.end_date, period.end_date + timedelta(days=2)):
        monkeypatch.setattr(worklog_workflow, "local_today", lambda today=today: today)
        assert "submit" in api.get(f"/worklogs/{log.id}", "chw1")["available_actions"]


def test_returned_work_can_come_back_before_the_last_day(api, db, waiting_log):
    log, _ = waiting_log
    log.status = "RETURNED_TO_PROVIDER"
    db.commit()
    assert "submit" in api.get(f"/worklogs/{log.id}", "chw1")["available_actions"]


def test_each_month_opens_by_itself_on_the_26th(api, db, monkeypatch):
    def globals_in_2090():
        return db.query(PayPeriod).filter(PayPeriod.region_id.is_(None), PayPeriod.start_date.between(date(2090, 1, 1), date(2090, 12, 31))).order_by(PayPeriod.start_date).all()

    try:
        for today in (date(2090, 10, 26), date(2090, 11, 25)):
            monkeypatch.setattr(pay_periods, "local_today", lambda today=today: today)
            api.get("/admin/pay-periods", "central1")
        db.expire_all()
        assert [(p.start_date, p.end_date, p.period_label, p.status) for p in globals_in_2090()] == [
            (date(2090, 10, 26), date(2090, 11, 25), "November 2090", "OPEN")]
        monkeypatch.setattr(pay_periods, "local_today", lambda: date(2090, 11, 26))
        api.get("/admin/pay-periods", "central1")
        db.expire_all()
        assert [p.period_label for p in globals_in_2090()] == ["November 2090", "December 2090"]
    finally:
        db.rollback()
        for row in globals_in_2090():
            db.delete(row)
        db.commit()


def test_a_schedule_already_covering_the_month_is_left_alone(api, db, monkeypatch, temporary):
    temporary(PayPeriod(start_date=date(2091, 3, 1), end_date=date(2091, 3, 31), status="OPEN", period_label="Own dates"))
    monkeypatch.setattr(pay_periods, "local_today", lambda: date(2091, 3, 10))
    api.get("/admin/pay-periods", "central1")
    assert db.query(PayPeriod).filter(PayPeriod.start_date.between(date(2091, 1, 1), date(2091, 12, 31))).count() == 1


@pytest.mark.parametrize("year,sunday", [(2024, date(2024, 3, 31)), (2025, date(2025, 4, 20)), (2026, date(2026, 4, 5)), (2027, date(2027, 3, 28))])
def test_easter_dates(year, sunday):
    assert easter_sunday(year) == sunday


def test_fixed_holidays_and_easter_are_built_in(api):
    days = {row["date"]: row for row in api.get("/public-holidays?year=2026", "chw1")}
    assert days["2026-12-09"]["name_sw"] == "Siku ya Uhuru" and days["2026-12-09"]["id"] is None
    assert days["2026-04-03"]["name_en"] == "Good Friday" and days["2026-04-06"]["name_en"] == "Easter Monday"
    assert len(days) == 13


def test_a_day_that_is_already_a_holiday_cannot_be_added_twice(api):
    api.post("/public-holidays", "central1", {"holiday_date": "2026-12-25", "name_en": "Other", "name_sw": "Nyingine"}, expect=409)


def test_only_administrators_add_or_remove_holidays(api):
    api.post("/public-holidays", "chw1", {"holiday_date": "2096-03-03", "name_en": "Eid", "name_sw": "Idi"}, expect=403)


def test_an_announced_holiday_reaches_the_timesheet_and_the_salary_file(api, db, crossing):
    year, number = map(int, crossing["month"].split("-"))
    taken = {row["date"] for row in api.get(f"/public-holidays?year={year}", "central1")}
    day = next(date(year, number, value) for value in range(14, 21) if date(year, number, value).isoformat() not in taken)
    added = api.post("/public-holidays", "central1", {"holiday_date": day.isoformat(), "name_en": "Eid al-Fitr", "name_sw": "Idd el-Fitr"})
    try:
        assert any(row["name_en"] == "Eid al-Fitr" for row in api.get(crossing["summary"], "csofin1")["holidays"])
        assert f"{day.isoformat()} Eid al-Fitr" in file_rows(api, crossing)[0]["Public holidays"]
        names = [row["name_sw"] for row in api.get(f"/worklogs/{crossing['log_id']}", "chw1")["period"]["holidays"]]
        assert "Idd el-Fitr" in names
    finally:
        api.client.delete(f"/public-holidays/{added['id']}", headers={"Authorization": f"Bearer {api.token('central1')}"})
    assert not any(row["name_en"] == "Eid al-Fitr" for row in api.get(crossing["summary"], "csofin1")["holidays"])
    assert db.query(AuditEvent).filter_by(entity_type="public_holiday", action="remove").count() >= 1
