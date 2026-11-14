"""The Excel template for an approved roster or engagement list, and reading it back for import.

Rosters are filled in Excel. Saved as CSV, Excel drops the leading 0 of a phone number and rewrites dates in the
computer's own format, so the template keeps every cell as text and the import takes the workbook itself.
"""
import csv
import io
import zipfile
from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..core.serialize import spreadsheet_safe
from ..models import Cadre, CommunityArea, District, Facility, Organization, Region, Section, Ward
from .staff_registry import ROSTER_COLUMNS, ROSTER_REQUIRED

ROSTER_SHEET = "Roster"
TEMPLATE_ROWS = 1000  # rows prepared as text, with dropdowns
MAX_ROWS = 20000  # an import larger than this should be split
MAX_UNPACKED_BYTES = 100 * 1024 * 1024
XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

GUIDE = {  # column: (what to enter, example)
    "first_name": ("First name, as on the approved list.", "Amina"),
    "middle_name": ("Middle name, if any.", "Juma"),
    "last_name": ("Last name (surname).", "Mwakyusa"),
    "phone": ("Mobile number. It identifies the person: a number already registered moves that person to the "
              "place on this row instead of adding someone new. Spaces and dashes are ignored.", "0712345678"),
    "cadre": ("Cadre code from the list (not the full name).", "CHW"),
    "occupation": ("Occupation within the cadre. See Accepted values for each cadre's options.", ""),
    "salary_scale": ("Salary scale, if the approved list gives one.", ""),
    "region": ("Region, spelled as in Accepted values.", ""),
    "district": ("District within that region. Needed when a ward or facility is given.", ""),
    "ward": ("Ward within that district. Needed when a facility is given.", ""),
    "facility": ("Facility in that ward. A name not yet in the system is added to the ward.", ""),
    "community_area": ("Community area, for community-based staff.", ""),
    "section": ("Section code, for cadres that work in a facility section.", ""),
    "organization": ("The CSO that engages and pays this person, spelled as in Accepted values.", ""),
    "start_date": ("Start date as YYYY-MM-DD (year-month-day).", "2026-09-26"),
}


def _places(db: Session, region_ids: Optional[set[int]]):
    regions = db.query(Region).order_by(Region.name)
    if region_ids is not None:
        regions = regions.filter(Region.id.in_(region_ids or {-1}))
    regions = regions.all()
    ids = [r.id for r in regions] or [-1]
    names = {r.id: r.name for r in regions}
    districts = db.query(District).filter(District.region_id.in_(ids)).order_by(District.name).all()
    district_ids = [d.id for d in districts] or [-1]
    district = {d.id: d for d in districts}
    wards = db.query(Ward).filter(Ward.district_id.in_(district_ids)).order_by(Ward.name).all()
    ward = {w.id: w for w in wards}
    facilities = db.query(Facility).filter(Facility.ward_id.in_([w.id for w in wards] or [-1])).order_by(Facility.name).all()
    areas = db.query(CommunityArea).filter(CommunityArea.district_id.in_(district_ids)).order_by(CommunityArea.name).all()
    rows = [("region", r.name, "", "", "") for r in regions]
    rows += [("district", d.name, names[d.region_id], "", "") for d in districts]
    rows += [("ward", w.name, names[district[w.district_id].region_id], district[w.district_id].name, "") for w in wards]
    rows += [("facility", f.name, names[district[ward[f.ward_id].district_id].region_id],
              district[ward[f.ward_id].district_id].name, ward[f.ward_id].name) for f in facilities]
    rows += [("community_area", a.name, names[district[a.district_id].region_id], district[a.district_id].name,
              ward[a.ward_id].name if a.ward_id in ward else "") for a in areas]
    return regions, rows


def build_template(db: Session, region_ids: Optional[set[int]]) -> bytes:
    """region_ids limits the places offered to an administrator's own regions; None offers every region."""
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    cadres = db.query(Cadre).filter(Cadre.is_active.is_(True)).order_by(Cadre.code).all()
    sections = db.query(Section).order_by(Section.code).all()
    orgs = db.query(Organization).filter(Organization.is_active.is_(True), Organization.type == "CSO").order_by(Organization.name).all()
    regions, places = _places(db, region_ids)

    wb = Workbook()
    roster = wb.active
    roster.title = ROSTER_SHEET
    required_fill = PatternFill("solid", fgColor="FDE9C4")
    roster.append(ROSTER_COLUMNS)
    for index, column in enumerate(ROSTER_COLUMNS, start=1):
        cell = roster.cell(row=1, column=index)
        cell.font = Font(bold=True)
        if column in ROSTER_REQUIRED:
            cell.fill = required_fill
        text, example = GUIDE[column]
        note = ("Required. " if column in ROSTER_REQUIRED else "Optional. ") + text + (f" Example: {example}" if example else "")
        cell.comment = Comment(note, "HRH system", width=320, height=120)
        letter = get_column_letter(index)
        roster.column_dimensions[letter].width = max(14, len(column) + 4)
        # Text, so Excel keeps a phone's leading 0 and a date exactly as typed.
        for row in range(2, TEMPLATE_ROWS + 2):
            roster.cell(row=row, column=index).number_format = "@"
    roster.freeze_panes = "A2"

    # Dropdowns read their choices from a hidden sheet; a typed value outside the list is refused by Excel.
    lists = wb.create_sheet("Lists")
    choices = {
        "cadre": [c.code for c in cadres],
        "region": [r.name for r in regions],
        "section": [s.code for s in sections],
        "organization": [o.name for o in orgs],
    }
    for list_index, (column, values) in enumerate(choices.items(), start=1):
        letter = get_column_letter(list_index)
        lists.cell(row=1, column=list_index, value=column)
        for row, value in enumerate(values, start=2):
            lists.cell(row=row, column=list_index, value=spreadsheet_safe(value))
        if not values:
            continue
        rule = DataValidation(type="list", formula1=f"=Lists!${letter}$2:${letter}${len(values) + 1}", allow_blank=True,
                              showErrorMessage=True, errorTitle="Not on the list",
                              error=f"Choose a {column.replace('_', ' ')} from the list.")
        target = get_column_letter(ROSTER_COLUMNS.index(column) + 1)
        rule.add(f"{target}2:{target}{TEMPLATE_ROWS + 1}")
        roster.add_data_validation(rule)
    lists.sheet_state = "hidden"

    guide = wb.create_sheet("How to fill")
    guide.append(["Approved roster / engagement list"])
    guide["A1"].font = Font(bold=True, size=14)
    for line in (
        "Fill one row per person on the Roster sheet. Keep the first row (the column names) as it is.",
        "Shaded columns are required. Leave optional cells empty when they do not apply.",
        "Choose cadre, region, section and organization from the dropdowns. Place names must match Accepted values.",
        "Upload this file under Staff > Import an approved roster, choosing Roster import or Engagement list.",
        "Each row is checked on its own: rows with a problem are listed by line number and the rest are imported.",
    ):
        guide.append([line])
    guide.append([])
    guide.append(["Column", "Required", "What to enter", "Example"])
    for cell in guide[guide.max_row]:
        cell.font = Font(bold=True)
    for column in ROSTER_COLUMNS:
        text, example = GUIDE[column]
        guide.append([column, "Yes" if column in ROSTER_REQUIRED else "No", text, example])
    guide.column_dimensions["A"].width = 18
    guide.column_dimensions["B"].width = 10
    guide.column_dimensions["C"].width = 90
    guide.column_dimensions["D"].width = 14
    for row in guide.iter_rows(min_row=9):
        row[2].alignment = Alignment(wrap_text=True, vertical="top")

    accepted = wb.create_sheet("Accepted values")
    accepted.append(["column", "value", "name or region", "district", "ward / options"])
    for cell in accepted[1]:
        cell.font = Font(bold=True)
    for c in cadres:
        accepted.append(["cadre", c.code, c.name, "", ", ".join(c.occupation_options or [])])
    for c in cadres:
        for option in c.occupation_options or []:
            accepted.append(["occupation", option, f"for {c.code}", "", ""])
    for s in sections:
        accepted.append(["section", s.code, s.name, "", ""])
    for o in orgs:
        accepted.append(["organization", o.name, "", "", ""])
    for row in places:
        accepted.append(list(row))
    for row in accepted.iter_rows(min_row=2):
        for cell in row:
            cell.value = spreadsheet_safe(cell.value)
    for letter, width in zip("ABCDE", (16, 36, 28, 24, 40)):
        accepted.column_dimensions[letter].width = width
    accepted.freeze_panes = "A2"
    accepted.auto_filter.ref = f"A1:E{max(accepted.max_row, 1)}"

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    # A phone typed into a number cell loses its leading 0; it then fails or is reported, never silently guessed.
    return str(value).strip()


def xlsx_to_csv(raw: bytes) -> str:
    """The Roster sheet (or the first sheet) as CSV text, for the same row-by-row import as a CSV file."""
    from openpyxl import load_workbook
    unreadable = HTTPException(422, "This file could not be read as an Excel workbook. Save it as .xlsx or .csv and try again.")
    try:
        # A small file can unpack to gigabytes; refuse before opening anything that large.
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if sum(item.file_size for item in archive.infolist()) > MAX_UNPACKED_BYTES:
                raise HTTPException(413, "This workbook is too large to import; split it and import the parts")
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    except HTTPException:
        raise
    except Exception:
        raise unreadable
    try:
        sheet = wb[ROSTER_SHEET] if ROSTER_SHEET in wb.sheetnames else wb.worksheets[0]
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        rows = 0
        for values in sheet.iter_rows(values_only=True, max_col=len(ROSTER_COLUMNS) + 10):
            cells = [_text(v) for v in values]
            if not any(cells):
                # An empty line is skipped by the import but still counted, so reported line numbers match Excel's.
                buffer.write("\r\n")
                continue
            rows += 1
            if rows > MAX_ROWS + 1:
                raise HTTPException(413, f"The file has more than {MAX_ROWS:,} rows; split it and import the parts")
            writer.writerow(cells)
        return buffer.getvalue().replace("\x00", "")  # the database cannot store NUL characters
    finally:
        wb.close()
