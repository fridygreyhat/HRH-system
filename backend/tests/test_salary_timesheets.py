"""A CSO downloads only signed Payroll timesheets, as CSV or PDF, with salary, bank details and days signed."""
import copy
import csv
import io
import uuid
from contextlib import contextmanager
from datetime import date, time

import pytest

from backend.models import (AuditEvent, Cadre, CommunityArea, CSORegionAssignment, District, Facility, FinanceMonthlyReport, PaymentClaim,
                            PayPeriod, Region, SalaryScaleAmount, Staff, StaffAssignment, User, UserScope, WorkLog, WorkLogEntry, WorkLogMeasure, utcnow)
from backend.services import monthly_report_approval as reports
from backend.services.salary_timesheets import hours_text
from .conftest import make_period
from .test_finance_missing_rates import unpriced_log
from .test_finance_monthly_reports import all_cadres
from .test_v22_finance import v22


def bearer(api, user):
    return {"Authorization": f"Bearer {api.token(user)}"}


def approved_log(db, period, provider="chw1", kind="PAYROLL", hours=8):
    log, entry, placement = unpriced_log(db, period, provider, kind)
    log.status = "APPROVED" if kind == "PAYROLL" else "PENDING_FINANCE_REVIEW"
    log.approved_at = log.attested_at = utcnow()
    entry.hours_worked = hours
    entry.start_time, entry.end_time = time(8, 0), time(16, 30)
    entry.comment = "PRIVATE-COMMENT"
    entry.evidence_text = "PRIVATE-EVIDENCE"
    entry.activity_snapshot = {**entry.activity_snapshot,
                               "field_definitions": [{"key": "clients", "label_en": "Clients served"}]}
    db.add(WorkLogMeasure(entry_id=entry.id, field_key="clients", value=5))
    db.commit()
    return log, entry, placement


def sign(api, v22, month, work_type="PAYROLL"):
    region = v22["region_id"]
    path = f"/finance/monthly-report?month={month}&region_id={region}&work_type={work_type}"
    report = api.get(path, v22["finance"])
    return api.post("/finance/monthly-report/approve", v22["finance"], {
        "month": month, "region_id": region, "work_type": work_type,
        "review_confirmed": True, "expected_digest": report["digest"]})


@pytest.fixture
def temporary(db):
    """The suite shares one database: remove anything a test adds that later tests would read."""
    rows = []

    def add(row):
        db.add(row)
        db.commit()
        rows.append(row)
        return row

    yield add
    db.rollback()
    for row in reversed(rows):
        db.delete(row)
        db.commit()


def timesheet_month(api, db, v22):
    """One Payroll timesheet in a month of its own. The suite has few past months left, so tests share these."""
    all_cadres(db, v22["finance"])
    all_cadres(db, "csofin1")
    _, entry, placement = approved_log(db, make_period(api, db), hours="8.5")
    month = entry.entry_date.strftime("%Y-%m")
    query = f"cso_id={placement.organization_id}&month={month}"
    return {"month": month, "entry_id": entry.id, "day": entry.entry_date.day, "log_id": entry.work_log_id,
            "staff_id": placement.staff_id, "organization_id": placement.organization_id,
            "scale": f"SCALE-{uuid.uuid4().hex[:8]}",
            "summary": f"/cso-finance/salary-timesheets?{query}", "export": f"/cso-finance/salary-timesheets/export?{query}"}


@contextmanager
def provider_details(db, state):
    """Give the provider a salary scale and bank details for one test, then put everything back."""
    person = db.get(Staff, state["staff_id"])
    saved = (person.salary_scale, person.bank_name, person.bank_account_number, person.bank_branch)
    person.salary_scale, person.bank_name, person.bank_account_number, person.bank_branch = state["scale"], "NMB", "0123456789", "Iringa"
    db.commit()
    yield {**state, "person": person}
    db.rollback()
    db.query(SalaryScaleAmount).filter_by(scale=state["scale"]).delete()
    person.salary_scale, person.bank_name, person.bank_account_number, person.bank_branch = saved
    db.commit()


_signed_month = {}


@pytest.fixture
def setup(api, db, v22):
    """A month Regional Finance has signed. Salary and bank details are read at download, so tests can vary them."""
    first = not _signed_month
    if first:
        _signed_month.update(timesheet_month(api, db, v22))
    with provider_details(db, _signed_month) as state:
        if first:
            sign(api, v22, state["month"])
        yield state


@pytest.fixture
def unsigned(api, db, v22):
    """A month nobody has signed yet, for tests that control the sign-off themselves."""
    with provider_details(db, timesheet_month(api, db, v22)) as state:
        yield state


def set_amount(api, setup, amount="750000.00", start=None):
    return api.call("PUT", "/salary-amounts", "fhifin1",
                    {"scale": setup["scale"], "start_month": start or setup["month"], "monthly_amount": amount})


def file_rows(api, setup, extra=""):
    response = api.client.get(setup["export"] + "&format=csv" + extra, headers=bearer(api, "csofin1"))
    assert response.status_code == 200, response.text
    return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))


def test_files_follow_the_sign_off_only(api, db, v22, unsigned):
    state = unsigned
    summary = api.get(state["summary"], "csofin1")
    assert summary["totals"]["providers"] == 0
    assert (v22["region_id"], False) in [(r["id"], r["signed"]) for r in summary["regions"]]
    for fmt in ("csv", "pdf"):
        api.get(f"{state['export']}&format={fmt}", "csofin1", expect=404)
    sign(api, v22, state["month"])
    assert file_rows(api, state)[0]["Total hours"] == "8 h 30 min"
    db.get(WorkLogEntry, state["entry_id"]).hours_worked = 2
    db.commit()
    assert file_rows(api, state)[0]["Total hours"] == "8 h 30 min"  # a later edit waits for a new sign-off
    sign(api, v22, state["month"])
    assert file_rows(api, state)[0]["Total hours"] == "2"


def test_csv_has_one_row_per_provider_with_hours_by_day(api, db, v22, setup):
    set_amount(api, setup)
    response = api.client.get(setup["export"] + "&format=csv", headers=bearer(api, "csofin1"))
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    text = response.content.decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    assert len(rows) == 1
    row = rows[0]
    assert row["Days worked"] == "1" and row["Total hours"] == "8 h 30 min"
    assert row[f"Day {setup['day']}"] == "8 h 30 min"
    assert row["Regional Finance sign-off"]
    assert row["Provider"] == setup["person"].legal_name
    assert row["Days signed by provider"] == "1"
    assert row["Monthly salary (TZS)"] == "750000.00"
    assert (row["Bank name"], row["Bank account number"], row["Bank branch"]) == ("NMB", "0123456789", "Iringa")
    assert row["Payment check"] == ""


def test_pdf_downloads_and_the_download_is_audited(api, db, v22, setup):
    response = api.client.get(setup["export"] + "&format=pdf", headers=bearer(api, "csofin1"))
    assert response.status_code == 200
    assert "application/pdf" in response.headers["content-type"]
    assert response.content.startswith(b"%PDF")
    audit = db.query(AuditEvent).filter_by(action="download_salary_timesheets").order_by(AuditEvent.id.desc()).first()
    assert audit is not None and audit.after["format"] == "pdf" and audit.after["bank_details"] is True
    assert list(audit.after["salaries"]) == [str(setup["staff_id"])]


def test_files_leave_out_clinical_detail_and_the_report_stays_aggregate(api, v22, setup):
    text = api.client.get(setup["export"] + "&format=csv", headers=bearer(api, "csofin1")).content.decode("utf-8-sig")
    for private in ("Clients served", "PRIVATE-COMMENT", "PRIVATE-EVIDENCE"):
        assert private not in text
    summary = api.get(setup["summary"], "csofin1")
    assert "0123456789" not in str(summary) and "NMB" not in str(summary)  # bank details are only in the file
    assert "attendance" not in str(summary)
    report = api.get(f"/finance/monthly-report?month={setup['month']}&work_type=PAYROLL&region_id={v22['region_id']}", "csofin1")
    assert all(not set(reports.TIMESHEET_KEYS) & set(p) for p in report["report"]["providers"])
    assert "0123456789" not in str(report)


def test_other_csos_and_other_roles_cannot_download(api, v22, setup):
    api.get(setup["export"] + "&format=csv", "csofin3", expect=404)  # another CSO's account, this CSO's id
    api.get(setup["export"] + "&format=csv", "chw1", expect=403)
    api.get(setup["export"] + "&format=csv", v22["finance"], expect=403)
    api.get(f"{setup['export']}&format=csv&region_id=999999", "csofin1", expect=403)
    api.get(f"{setup['export']}&format=docx", "csofin1", expect=422)


def test_another_cso_sharing_the_region_cannot_read_this_csos_timesheets(api, db, v22, setup, temporary):
    other = db.query(User).filter_by(username="csofin3").one()
    other_org = db.query(UserScope).filter(UserScope.user_id == other.id, UserScope.organization_id.isnot(None)).first().organization_id
    temporary(UserScope(user_id=other.id, region_id=v22["region_id"]))
    temporary(CSORegionAssignment(organization_id=other_org, region_id=v22["region_id"], is_active=True))
    all_cadres(db, "csofin3")
    api.get(setup["summary"], "csofin3", expect=404)
    api.get(setup["export"] + "&format=csv", "csofin3", expect=404)
    own = f"/cso-finance/salary-timesheets?cso_id={other_org}&month={setup['month']}"
    assert api.get(own, "csofin3")["totals"]["providers"] == 0


def second_region(db, v22, setup, temporary):
    region = temporary(Region(name=f"Test region {uuid.uuid4().hex[:8]}"))
    user = db.query(User).filter_by(username="csofin1").one()
    if db.query(UserScope).filter(UserScope.user_id == user.id, UserScope.region_id.isnot(None)).count():
        temporary(UserScope(user_id=user.id, region_id=region.id))
    temporary(CSORegionAssignment(organization_id=setup["organization_id"], region_id=region.id, is_active=True))
    return region


def test_choosing_a_region_limits_the_file_to_that_region(api, db, v22, setup, temporary):
    second = second_region(db, v22, setup, temporary)
    everything = api.get(setup["summary"], "csofin1")
    assert everything["totals"]["providers"] == 1
    assert {r["id"]: r["signed"] for r in everything["regions"]}[second.id] is False
    assert {r["id"]: r["signed"] for r in everything["regions"]}[v22["region_id"]] is True
    assert api.get(f"{setup['summary']}&region_id={v22['region_id']}", "csofin1")["totals"]["providers"] == 1
    assert api.get(f"{setup['summary']}&region_id={second.id}", "csofin1")["totals"]["providers"] == 0
    api.get(f"{setup['export']}&region_id={second.id}&format=csv", "csofin1", expect=404)


def test_each_row_names_the_region_facility_and_cadre_before_and_in_the_export(api, db, setup):
    set_amount(api, setup, "900000.00")
    assignment = db.query(StaffAssignment).filter_by(staff_id=setup["staff_id"]).first()
    region = db.get(Region, assignment.region_id).name
    facility = db.get(Facility, assignment.facility_id).name
    area = db.get(CommunityArea, assignment.community_area_id).name  # the demo CHW has both, so counts as community
    cadre = db.get(Cadre, setup["person"].cadre_id).name
    listed = api.get(setup["summary"], "csofin1")["providers"]
    assert listed == [{"staff_id": setup["staff_id"], "provider_name": setup["person"].legal_name, "cadre_name": cadre,
                       "facility_name": facility, "community_area_name": area, "work_setting": "Community",
                       "region_name": region, "days_signed": 1, "monthly_salary": "900000.00", "checks": []}]
    row = file_rows(api, setup)[0]
    assert (row["Region"], row["Facility"], row["Community area"], row["Cadre"]) == (region, facility, area, cadre)


def staff_of(db, username):
    return db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == username).one()


@contextmanager
def placed(db, username, **values):
    """Move a provider's placement for one step, then put it back. A sign-off keeps what it saw."""
    placement = db.query(StaffAssignment).filter_by(staff_id=staff_of(db, username).id).first()
    saved = {key: getattr(placement, key) for key in values}
    for key, value in values.items():
        setattr(placement, key, value)
    db.commit()
    yield placement
    db.rollback()
    for key, value in saved.items():
        setattr(placement, key, value)
    db.commit()


_mixed_month = {}


@pytest.fixture
def mixed(api, db, v22, temporary):
    """A signed month in the CSO's region: chw1 at a facility, hcp1 in a community area, clerk1 with no CSO on the placement."""
    first = not _mixed_month
    if first:
        all_cadres(db, v22["finance"])
        all_cadres(db, "csofin1")
        period = make_period(api, db)
        _, entry, placement = approved_log(db, period)
        approved_log(db, period, "hcp1")
        approved_log(db, period, "clerk1")
        area = temporary(CommunityArea(district_id=db.query(District.id).first()[0], name=f"Kijiji {uuid.uuid4().hex[:8]}"))
        month = entry.entry_date.strftime("%Y-%m")
        query = f"cso_id={placement.organization_id}&month={month}"
        _mixed_month.update(month=month, day=entry.entry_date.day, staff_id=placement.staff_id, area=area.name,
                            organization_id=placement.organization_id, scale=f"SCALE-{uuid.uuid4().hex[:8]}",
                            summary=f"/cso-finance/salary-timesheets?{query}", export=f"/cso-finance/salary-timesheets/export?{query}")
    community = {**_mixed_month, "staff_id": staff_of(db, "hcp1").id}
    with provider_details(db, _mixed_month) as state, provider_details(db, community) as other:
        if first:
            with (placed(db, "chw1", community_area_id=None),
                  placed(db, "hcp1", region_id=placement.region_id, organization_id=placement.organization_id,
                         facility_id=None, community_area_id=area.id),
                  placed(db, "clerk1", region_id=placement.region_id, organization_id=None)):
                sign(api, v22, month)
        yield {**state, "facility_person": state["person"], "community_person": other["person"]}


def test_a_cso_sees_community_and_facility_salaries_in_its_region(api, mixed):
    set_amount(api, mixed, "700000.00")
    summary = api.get(mixed["summary"], "csofin1")
    rows = {row["provider_name"]: row for row in summary["providers"]}
    assert set(rows) == {mixed["facility_person"].legal_name, mixed["community_person"].legal_name}
    community = rows[mixed["community_person"].legal_name]
    assert (community["work_setting"], community["community_area_name"], community["facility_name"]) == ("Community", mixed["area"], "—")
    assert community["monthly_salary"] == "700000.00" and community["checks"] == []
    assert rows[mixed["facility_person"].legal_name]["work_setting"] == "Facility"
    assert summary["settings"] == [{"name": "Facility", "providers": 1, "salary": "700000.00"},
                                   {"name": "Community", "providers": 1, "salary": "700000.00"}]
    assert summary["totals"]["salary"] == "1400000.00"
    saved = {row["Provider"]: row for row in file_rows(api, mixed)}
    row = saved[mixed["community_person"].legal_name]
    assert (row["Work setting"], row["Community area"], row["Monthly salary (TZS)"]) == ("Community", mixed["area"], "700000.00")
    assert saved[mixed["facility_person"].legal_name]["Work setting"] == "Facility"
    report = api.get(f"/finance/monthly-report?month={mixed['month']}&work_type=PAYROLL", "csofin1")["report"]
    assert report["providers"] and all("community_area_name" not in row for row in report["providers"])


@pytest.mark.parametrize("setting,person", [("Facility", "facility_person"), ("Community", "community_person")])
def test_choosing_facility_or_community_limits_the_list_and_the_file(api, db, mixed, setting, person):
    set_amount(api, mixed, "700000.00")
    summary = api.get(f"{mixed['summary']}&setting={setting}", "csofin1")
    assert [row["provider_name"] for row in summary["providers"]] == [mixed[person].legal_name]
    assert summary["totals"]["salary"] == "700000.00"
    assert [row["Provider"] for row in file_rows(api, mixed, f"&setting={setting}")] == [mixed[person].legal_name]
    pdf = api.client.get(f"{mixed['export']}&setting={setting}&format=pdf", headers=bearer(api, "csofin1"))
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    event = db.query(AuditEvent).filter_by(action="download_salary_timesheets").order_by(AuditEvent.id.desc()).first()
    assert event.after["work_setting"] == setting


def test_only_facility_or_community_can_be_chosen(api, mixed):
    api.get(f"{mixed['summary']}&setting=Elsewhere", "csofin1", expect=422)


def test_a_cso_user_sees_only_the_regions_assigned_to_them(api, db, v22, mixed, temporary):
    other = temporary(Region(name=f"Test region {uuid.uuid4().hex[:8]}"))
    temporary(CSORegionAssignment(organization_id=mixed["organization_id"], region_id=other.id, is_active=True))
    summary = api.get(mixed["summary"], "csofin1")
    assert other.id not in {region["id"] for region in summary["regions"]}
    assert summary["totals"]["providers"] == 2
    api.get(f"{mixed['summary']}&region_id={other.id}", "csofin1", expect=403)
    api.get(f"{mixed['export']}&region_id={other.id}&format=csv", "csofin1", expect=403)


def test_a_signed_provider_with_no_cso_is_counted_and_never_silently_missing(api, v22, mixed):
    summary = api.get(mixed["summary"], "csofin1")
    region = {row["id"]: row for row in summary["regions"]}[v22["region_id"]]
    assert region["providers_without_cso"] == 1
    assert "clerk1" not in str(summary)


def test_the_no_cso_count_leaves_out_cadres_the_user_cannot_see(api, db, v22, mixed):
    from backend.models import UserReviewCadre
    user = db.query(User).filter_by(username="csofin1").one()
    clerk = db.query(Cadre).filter_by(code="DATA_CLERK").one()
    db.query(UserReviewCadre).filter_by(user_id=user.id, cadre_id=clerk.id).delete()
    db.commit()
    try:
        regions = api.get(mixed["summary"], "csofin1")["regions"]
        assert {row["id"]: row for row in regions}[v22["region_id"]]["providers_without_cso"] == 0
    finally:
        db.add(UserReviewCadre(user_id=user.id, cadre_id=clerk.id))
        db.commit()


def test_signing_again_after_a_placement_changed_saves_a_new_sign_off(api, db, v22, temporary):
    all_cadres(db, v22["finance"])
    all_cadres(db, "csofin1")
    period = make_period(api, db)
    _, entry, placement = approved_log(db, period, "hcp2")
    month = entry.entry_date.strftime("%Y-%m")
    area = temporary(CommunityArea(district_id=db.query(District.id).first()[0], name=f"Kijiji {uuid.uuid4().hex[:8]}"))
    query = f"/cso-finance/salary-timesheets?cso_id={_org(db)}&month={month}"
    with placed(db, "hcp2", region_id=v22["region_id"], organization_id=None):
        sign(api, v22, month)
    count = db.query(FinanceMonthlyReport).filter_by(month=month).count()
    assert api.get(query, "csofin1")["totals"]["providers"] == 0
    # Only the placement's CSO and area change here, so the regional totals and their digest stay the same.
    with placed(db, "hcp2", region_id=v22["region_id"], organization_id=_org(db), community_area_id=area.id):
        sign(api, v22, month)
        sign(api, v22, month)  # nothing changed the second time, so nothing new is saved
    assert db.query(FinanceMonthlyReport).filter_by(month=month).count() == count + 1
    row = api.get(query, "csofin1")["providers"][0]
    assert (row["work_setting"], row["community_area_name"]) == ("Community", area.name)


def _org(db):
    user = db.query(User).filter_by(username="csofin1").one()
    return db.query(UserScope).filter(UserScope.user_id == user.id, UserScope.organization_id.isnot(None)).first().organization_id


def test_two_community_areas_in_one_month_stay_on_separate_rows(api, db, v22, setup, temporary):
    all_cadres(db, v22["finance"])
    staff = staff_of(db, "hcp2")
    periods = db.query(PayPeriod).filter(PayPeriod.status != "ARCHIVED").limit(2).all()
    day = date.fromisoformat(f"{setup['month']}-{setup['day']:02d}")
    for period in periods:
        area = temporary(CommunityArea(district_id=db.query(District.id).first()[0], name=f"Kijiji {uuid.uuid4().hex[:8]}"))
        placement = temporary(StaffAssignment(staff_id=staff.id, region_id=v22["region_id"], community_area_id=area.id,
                                              organization_id=setup["organization_id"], start_date=day))
        log = temporary(WorkLog(staff_id=staff.id, assignment_id=placement.id, cadre_id=staff.cadre_id, period_id=period.id,
                                workflow_version=2, work_type="PAYROLL", status="APPROVED", approved_at=utcnow(), attested_at=utcnow()))
        temporary(WorkLogEntry(work_log_id=log.id, entry_date=day, hours_worked=8, evidence_text="Test", activity_snapshot={}))
    report = api.get(f"/finance/monthly-report?month={setup['month']}&region_id={v22['region_id']}&work_type=PAYROLL", v22["finance"])["report"]
    assert len([p for p in report["providers"] if p["staff_id"] == staff.id]) == 2


def test_salary_is_the_full_month_however_many_days_were_signed(api, v22, setup):
    set_amount(api, setup, "900000.00")
    summary = api.get(setup["summary"], "csofin1")
    assert summary["totals"]["days_signed"] == 1 and summary["totals"]["salary"] == "900000.00"
    assert file_rows(api, setup)[0]["Monthly salary (TZS)"] == "900000.00"


def test_the_amount_in_force_for_the_month_is_used(api, v22, setup):
    year, number = map(int, setup["month"].split("-"))
    earlier = f"{year - 1}-{number:02d}"
    later = f"{year + 1}-{number:02d}"
    set_amount(api, setup, "500000.00", earlier)
    set_amount(api, setup, "700000.00", later)  # a later rise must not change this month
    assert file_rows(api, setup)[0]["Monthly salary (TZS)"] == "500000.00"
    set_amount(api, setup, "600000.00", setup["month"])
    assert file_rows(api, setup)[0]["Monthly salary (TZS)"] == "600000.00"


def test_no_amount_stays_in_the_file_as_missing_never_zero(api, v22, setup):
    summary = api.get(setup["summary"], "csofin1")
    assert summary["missing_salary"] == [setup["person"].legal_name] and summary["totals"]["salary"] == "0"
    row = file_rows(api, setup)[0]
    assert row["Monthly salary (TZS)"] == "" and row["Payment check"] == "Salary amount missing"


def test_missing_bank_details_are_flagged_without_blocking_the_download(api, db, v22, setup):
    set_amount(api, setup)
    setup["person"].bank_branch = None
    db.commit()
    assert api.get(setup["summary"], "csofin1")["missing_bank"] == [setup["person"].legal_name]
    row = file_rows(api, setup)[0]
    assert row["Payment check"] == "Bank details missing" and row["Monthly salary (TZS)"] == "750000.00"
    assert api.client.get(setup["export"] + "&format=pdf", headers=bearer(api, "csofin1")).status_code == 200


def test_bank_details_are_the_latest_saved_at_download(api, db, v22, setup):
    setup["person"].bank_account_number = "9999999999"
    db.commit()
    assert file_rows(api, setup)[0]["Bank account number"] == "9999999999"


def test_a_timesheet_the_provider_did_not_sign_shows_no_salary(api, db, v22, unsigned):
    state = unsigned
    set_amount(api, state)
    db.get(WorkLog, state["log_id"]).attested_at = None
    db.commit()
    sign(api, v22, state["month"])
    summary = api.get(state["summary"], "csofin1")
    assert summary["not_signed"] == [state["person"].legal_name] and summary["totals"]["salary"] == "0"
    row = file_rows(api, state)[0]
    assert row["Days signed by provider"] == "0" and row["Monthly salary (TZS)"] == ""
    assert row["Payment check"] == "Provider has not signed this timesheet"


def test_a_provider_with_two_placements_gets_one_salary(api, db, v22, setup):
    set_amount(api, setup, "800000.00")
    latest = db.query(FinanceMonthlyReport).filter_by(month=setup["month"], work_type="PAYROLL").order_by(FinanceMonthlyReport.id.desc()).first()
    snapshot = copy.deepcopy(latest.snapshot)
    providers = snapshot["organizations"][str(setup["organization_id"])]["providers"]
    providers.append({**providers[0], "facility_name": "Second facility", "days": 2, "days_signed": 2})
    fake = type("Signed", (), {"snapshot": snapshot, "approved_at": latest.approved_at})()
    original = reports.latest
    reports.latest = lambda _db, _month, region, _kind: fake if region == v22["region_id"] else None
    try:
        rows = file_rows(api, setup)
        summary = api.get(setup["summary"], "csofin1")
    finally:
        reports.latest = original
    assert sorted(row["Monthly salary (TZS)"] for row in rows) == ["", "800000.00"]
    assert summary["totals"]["salary"] == "800000.00"
    assert "Salary is on this provider's other row" in {row["Payment check"] for row in rows}


def test_only_central_finance_can_set_salary_amounts(api, db, setup):
    for user in ("csofin1", "rpm1", "chw1"):
        api.call("PUT", "/salary-amounts", user, {"scale": setup["scale"], "start_month": setup["month"], "monthly_amount": "1"}, expect=403)
        api.get(f"/salary-amounts?month={setup['month']}", user, expect=403)
    set_amount(api, setup, "750000.00")
    set_amount(api, setup, "760000.00")  # same scale and month: a correction, kept in the audit trail
    assert db.query(SalaryScaleAmount).filter_by(scale=setup["scale"]).count() == 1
    audit = db.query(AuditEvent).filter_by(action="set_salary_amount").order_by(AuditEvent.id.desc()).first()
    assert audit.before == {"monthly_amount": "750000.00"} and audit.after["monthly_amount"] == "760000.00"
    row = next(r for r in api.get(f"/salary-amounts?month={setup['month']}", "fhifin1") if r["scale"] == setup["scale"])
    assert row["monthly_amount"] == "760000.00" and row["providers"] == 1


@pytest.mark.parametrize("amount", ["0", "-5", "1.234"])
def test_salary_amounts_must_be_positive_money(api, setup, amount):
    api.call("PUT", "/salary-amounts", "fhifin1", {"scale": setup["scale"], "start_month": setup["month"], "monthly_amount": amount}, expect=422)


def test_a_cso_with_no_region_scope_sees_pay_periods_of_its_linked_regions(api, db, temporary):
    user = db.query(User).filter_by(username="csofin3").one()
    org = db.query(UserScope).filter(UserScope.user_id == user.id, UserScope.organization_id.isnot(None)).first().organization_id
    linked = db.query(CSORegionAssignment).filter_by(organization_id=org, is_active=True).first().region_id
    other = temporary(Region(name=f"Test region {uuid.uuid4().hex[:8]}"))
    mine = temporary(PayPeriod(start_date=date(2031, 1, 1), end_date=date(2031, 1, 31), status="OPEN", region_id=linked))
    theirs = temporary(PayPeriod(start_date=date(2031, 2, 1), end_date=date(2031, 2, 28), status="OPEN", region_id=other.id))
    # Real CSO accounts carry only their organization; other tests may have added regions to this demo user.
    extra = db.query(UserScope).filter(UserScope.user_id == user.id, UserScope.region_id.isnot(None)).all()
    regions = [row.region_id for row in extra]
    for row in extra:
        db.delete(row)
    db.commit()
    try:
        ids = {row["id"] for row in api.get("/cso-finance/pay-periods", "csofin3")}
    finally:
        db.add_all(UserScope(user_id=user.id, region_id=region) for region in regions)
        db.commit()
    assert mine.id in ids and theirs.id not in ids


def test_cadres_outside_the_cso_users_scope_are_left_out(api, db, v22, setup):
    from backend.models import UserReviewCadre
    user = db.query(User).filter_by(username="csofin1").one()
    grants = [row.cadre_id for row in db.query(UserReviewCadre).filter_by(user_id=user.id)]
    db.query(UserReviewCadre).filter_by(user_id=user.id).delete()
    db.commit()
    try:
        assert api.get(setup["summary"], "csofin1")["totals"]["providers"] == 0
    finally:
        db.add_all(UserReviewCadre(user_id=user.id, cadre_id=cadre) for cadre in grants)
        db.commit()


def test_services_reports_are_never_in_a_salary_file(api, db, period, v22):
    all_cadres(db, v22["finance"])
    all_cadres(db, "csofin1")
    _, entry, placement = approved_log(db, period, kind="SERVICES")
    month = entry.entry_date.strftime("%Y-%m")
    sign(api, v22, month, "SERVICES")
    summary = api.get(f"/cso-finance/salary-timesheets?cso_id={placement.organization_id}&month={month}", "csofin1")
    assert summary["totals"]["providers"] == 0


def test_a_sign_off_from_before_these_fields_still_works(api, db, v22, setup):
    set_amount(api, setup)
    latest = db.query(FinanceMonthlyReport).filter_by(month=setup["month"], work_type="PAYROLL").order_by(FinanceMonthlyReport.id.desc()).first()
    snapshot = copy.deepcopy(latest.snapshot)
    for report in snapshot["organizations"].values():
        for provider in report["providers"]:
            for key in reports.TIMESHEET_KEYS:
                provider.pop(key)
    fake = type("Signed", (), {"snapshot": snapshot, "approved_at": latest.approved_at})()
    original = reports.latest
    reports.latest = lambda _db, _month, region, _kind: fake if region == v22["region_id"] else None
    try:
        row = file_rows(api, setup)[0]
        pdf = api.client.get(setup["export"] + "&format=pdf", headers=bearer(api, "csofin1"))
    finally:
        reports.latest = original
    assert row["Days signed by provider"] == "1" and row["Monthly salary (TZS)"] == "750000.00"
    assert row[f"Day {setup['day']}"] == "" and pdf.status_code == 200


def test_downloading_creates_no_claim_or_payment(api, db, v22, setup):
    before = db.query(PaymentClaim).count()
    api.client.get(setup["export"] + "&format=csv", headers=bearer(api, "csofin1"))
    assert db.query(PaymentClaim).count() == before


@pytest.mark.parametrize("value,text", [("8", "8"), ("8.5", "8 h 30 min"), ("0.25", "0 h 15 min"), ("7.999999", "8")])
def test_hours_are_shown_as_hours_and_minutes(value, text):
    assert hours_text(value) == text
