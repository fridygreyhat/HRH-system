"""The Excel roster template: its columns, dropdowns and accepted values, and importing the filled workbook."""
from io import BytesIO

from openpyxl import load_workbook

from backend.services.staff_registry import ROSTER_COLUMNS, ROSTER_REQUIRED

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _template(api, user):
    response = api.get("/staff/import-template.xlsx", user)
    assert response.headers["content-type"] == XLSX
    assert "hrh-roster-template.xlsx" in response.headers["content-disposition"]
    return load_workbook(BytesIO(response.content))


def _accepted(wb, column):
    return {row[1] for row in wb["Accepted values"].iter_rows(min_row=2, values_only=True) if row[0] == column}


def test_template_has_the_roster_columns_as_text_with_dropdowns_and_a_guide(api, db):
    from backend.models import Cadre, Region
    wb = _template(api, "central1")
    roster = wb["Roster"]
    assert [c.value for c in roster[1]] == ROSTER_COLUMNS
    assert roster.max_row == 1 or not any(c.value for row in roster.iter_rows(min_row=2) for c in row)  # no sample people
    # Text cells keep a phone's leading 0 and an ISO date as typed.
    for column in ("phone", "start_date"):
        assert roster.cell(row=2, column=ROSTER_COLUMNS.index(column) + 1).number_format == "@"
    required = {c.value for c in roster[1] if c.fill.fgColor.rgb not in (None, "00000000")}
    assert required == set(ROSTER_REQUIRED)
    validated = {str(dv.sqref).split(":")[0][0] for dv in roster.data_validations.dataValidation}
    letters = {chr(ord("A") + ROSTER_COLUMNS.index(c)) for c in ("cadre", "region", "section", "organization")}
    assert letters <= validated
    assert wb["Lists"].sheet_state == "hidden"
    guide_columns = [row[0] for row in wb["How to fill"].iter_rows(min_row=9, values_only=True)]
    assert guide_columns == ROSTER_COLUMNS
    assert _accepted(wb, "cadre") == {c.code for c in db.query(Cadre).filter(Cadre.is_active.is_(True))}
    assert _accepted(wb, "region") == {r.name for r in db.query(Region)}


def test_regional_admins_get_only_their_own_places(api, db):
    from backend.models import Region
    wb = _template(api, "regadmin1")
    regions = _accepted(wb, "region")
    assert regions and regions < {r.name for r in db.query(Region)}
    assert "Iringa" in regions and "Njombe" not in regions
    assert all(row[2] in regions for row in wb["Accepted values"].iter_rows(min_row=2, values_only=True)
               if row[0] in ("district", "ward", "facility", "community_area"))


def test_only_administrators_download_the_template(api):
    api.get("/staff/import-template.xlsx", "chw1", expect=403)


def test_a_filled_template_imports_as_it_is(api, db):
    from backend.models import Staff
    wb = _template(api, "central1")
    roster = wb["Roster"]
    col = {name: index + 1 for index, name in enumerate(ROSTER_COLUMNS)}

    def fill(row, **values):
        for key, value in values.items():
            roster.cell(row=row, column=col[key], value=value)

    fill(2, first_name="Excel", last_name="Leading", phone="0799 000 201", cadre="CHW", region="Iringa", start_date="2023-02-01")
    fill(4, first_name="Excel", last_name="Dated", phone="0799000202", cadre="chw", region="Iringa")  # row 3 left empty
    roster.cell(row=4, column=col["start_date"]).value = __import__("datetime").date(2023, 3, 1)  # a real Excel date
    fill(5, first_name="Excel", last_name="Unknown", phone="0799000203", cadre="ALIEN", region="Iringa", start_date="2023-02-01")
    buffer = BytesIO()
    wb.save(buffer)
    result = api.call("POST", "/staff/import", "central1", data={"enrollment_source": "ENGAGEMENT_LIST"},
                      files={"file": ("filled roster.xlsx", buffer.getvalue(), XLSX)}, expect=201)
    assert (result["total_rows"], result["created_count"], result["error_count"]) == (3, 2, 1)
    assert result["errors"] == [{"line": 5, "error": "Unknown cadre 'ALIEN'"}]  # Excel's own row number
    people = {s.last_name: s for s in db.query(Staff).filter(Staff.first_name == "Excel")}
    assert people["Leading"].verified_phone == "+255799000201"  # saved in +255 form for SMS
    assert str(people["Dated"].employment_start_date) == "2023-03-01"
    assert people["Dated"].enrollment_source == "ENGAGEMENT_LIST"


def test_an_unreadable_or_oversized_workbook_is_refused_clearly(api):
    from unittest.mock import patch
    from backend.services import roster_template
    bad = api.call("POST", "/staff/import", "central1", files={"file": ("roster.xlsx", b"not a workbook", XLSX)}, expect=422)
    assert "Excel workbook" in bad["detail"]
    wb = _template(api, "central1")
    buffer = BytesIO()
    wb.save(buffer)
    with patch.object(roster_template, "MAX_UNPACKED_BYTES", 1000):
        api.call("POST", "/staff/import", "central1", files={"file": ("roster.xlsx", buffer.getvalue(), XLSX)}, expect=413)
