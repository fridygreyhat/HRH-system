"""CHW Payroll: every CHW is paid the CHW package (monthly stipend + transport + communication = 150,000 TZS a month)."""
from contextlib import contextmanager

from backend.models import AuditEvent, SalaryScaleAmount
from .test_salary_timesheets import approved_log, file_rows, mixed, temporary  # noqa: F401 (fixtures)
from .test_v22_finance import v22  # noqa: F401 (fixture)

PARTS = [{"key": "stipend", "name": "Monthly stipend", "amount": "100000.00"},
         {"key": "transport", "name": "Transport", "amount": "30000.00"},
         {"key": "communication", "name": "Communication", "amount": "20000.00"}]


@contextmanager
def no_saved_package(db):
    """Tests that save a CHW package remove it afterwards, so the rest of the suite sees the standard one."""
    try:
        yield
    finally:
        db.rollback()
        db.query(SalaryScaleAmount).filter_by(scale="CHW").delete()
        db.commit()


def test_the_chw_package_is_150000_in_three_parts(api, db, period, v22):
    month = period["start_date"][:7]
    rows = api.get(f"/salary-amounts?month={month}", "fhifin1")
    package = rows[0]  # listed first on Central Finance's page
    assert (package["scale"], package["is_chw_package"], package["monthly_amount"]) == ("CHW", True, "150000.00")
    assert package["components"] == PARTS and package["providers"] >= 1

    # The Payroll timesheet shows Finance the package and its parts, whatever salary scale the CHW has on record.
    log, _, _ = approved_log(db, period, "chw1")
    pay = api.get(f"/worklogs/{log.id}", v22["finance"])["payroll_pay"]
    assert (pay["salary_scale"], pay["monthly_salary"], pay["components"]) == ("CHW", "150000.00", PARTS)
    hidden = api.get(f"/worklogs/{log.id}", "rpm1")["payroll_pay"]
    assert hidden == {"amount_visible": False, "salary_scale": "CHW"}


def test_central_finance_changes_the_package_part_by_part(api, db):
    # A month no test signs: a new package from a signed month on takes those sign-offs back (as it must).
    month = "2095-01"
    with no_saved_package(db):
        bad = [{"stipend": "100000"}, {"stipend": "-1", "transport": "30000", "communication": "20000"},
               {"stipend": "0", "transport": "0", "communication": "0"},
               {"stipend": "100000.001", "transport": "30000", "communication": "20000"}]
        for components in bad:
            api.call("PUT", "/salary-amounts", "fhifin1", {"scale": "CHW", "start_month": month, "components": components}, expect=422)
        parts = {"stipend": "110000", "transport": "30000", "communication": "25000"}
        api.call("PUT", "/salary-amounts", "fhifin1", {"scale": "CHW", "start_month": month, "components": parts,
                                                       "monthly_amount": "1"}, expect=422)  # the total is the sum
        api.call("PUT", "/salary-amounts", "csofin1", {"scale": "CHW", "start_month": month, "components": parts}, expect=403)
        saved = api.call("PUT", "/salary-amounts", "fhifin1", {"scale": "chw", "start_month": month, "components": parts})
        assert (saved["scale"], saved["monthly_amount"]) == ("CHW", "165000.00")
        assert [part["amount"] for part in saved["components"]] == ["110000.00", "30000.00", "25000.00"]
        package = api.get(f"/salary-amounts?month={month}", "fhifin1")[0]
        assert package["monthly_amount"] == "165000.00" and package["history"][0]["monthly_amount"] == "165000.00"
        assert db.query(AuditEvent).filter_by(action="set_salary_amount").order_by(AuditEvent.id.desc()).first().after["components"]
        # Other scales are one amount, never parts.
        api.call("PUT", "/salary-amounts", "fhifin1", {"scale": "TGS C", "start_month": month, "monthly_amount": "800000",
                                                       "components": parts}, expect=422)


def test_the_cso_salary_file_shows_the_chw_parts(api, mixed):
    rows = {row["Provider"]: row for row in file_rows(api, mixed)}
    chw = rows[mixed["facility_person"].legal_name]  # chw1, at a facility in this month
    assert (chw["Salary scale"], chw["Monthly salary (TZS)"]) == ("CHW", "150000.00")
    assert (chw["Monthly stipend (TZS)"], chw["Transport (TZS)"], chw["Communication (TZS)"]) == ("100000.00", "30000.00", "20000.00")
    other = rows[mixed["community_person"].legal_name]  # hcp1: paid by salary scale, so no parts
    assert (other["Monthly stipend (TZS)"], other["Transport (TZS)"], other["Communication (TZS)"]) == ("", "", "")
    pdf = api.client.get(f"{mixed['export']}&format=pdf", headers={"Authorization": f"Bearer {api.token('csofin1')}"})
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_a_signed_month_that_lists_a_chw_follows_the_chw_package(db, mixed):
    """A new package from a signed month on takes that sign-off back, as a new scale amount does (the CSO must not pay
    an amount changed after signing). The sign-off lists the CHW under the package, whatever scale is on record."""
    from backend.services import monthly_report_approval as reports
    signed = reports.signed_with_scale(db, "CHW", mixed["month"])
    assert mixed["month"] in {row.month for row in signed}
    assert mixed["month"] not in {row.month for row in reports.signed_with_scale(db, "NO-SUCH-SCALE", mixed["month"])}
