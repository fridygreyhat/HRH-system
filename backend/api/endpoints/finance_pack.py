"""Finance downloads: timesheets, activity totals, payment summary and import file, Payroll and Services separate."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ...core import audit
from ...core.roles import CSO_FINANCE, FHI360_FINANCE, REGIONAL_FINANCE
from ...core.security import require_roles
from ...db.session import get_db
from ...services import finance_pack, payment_forms
from .provider_payment_details import private_response

router = APIRouter(dependencies=[Depends(private_response)])
FINANCE = require_roles(REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE)
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/options")
def options(db: Session = Depends(get_db), current=Depends(FINANCE)):
    """The work types and regions this person's downloads cover."""
    return {"work_types": finance_pack.work_types(current), "regions": finance_pack.regions(db, current),
            "cadres": finance_pack.cadres(db, current)}


@router.get("/facilities")
def facilities(region_id: int = Query(gt=0), db: Session = Depends(get_db), current=Depends(FINANCE)):
    return finance_pack.facilities(db, current, region_id)


def _selection(db, current, work_type, month, region_id, facility_id, staff_id, cadre_id=None):
    return finance_pack.pack(db, current, work_type, month, region_id, facility_id, staff_id, cadre_id)


@router.get("")
def summary(work_type: Literal["PAYROLL", "SERVICES"], month: str = Query(pattern=MONTH),
            region_id: Optional[int] = Query(default=None, gt=0), facility_id: Optional[int] = Query(default=None, gt=0),
            staff_id: Optional[int] = Query(default=None, gt=0), cadre_id: Optional[int] = Query(default=None, gt=0),
            db: Session = Depends(get_db), current=Depends(FINANCE)):
    """Who is in the selection, their days, hours, amount and status. Bank and phone numbers stay in the files."""
    data = _selection(db, current, work_type, month, region_id, facility_id, staff_id, cadre_id)
    keys = ("staff_id", "name", "cadre", "region", "facility", "community_area", "days", "hours", "amount", "currency", "state")
    return {**{k: data[k] for k in ("work_type", "month", "region", "facility", "totals")},
            "people": [{k: p[k] for k in keys} | {"activities": len(p["indicators"])} for p in data["people"]]}


FILES = {
    ("timesheets", "pdf"): ("application/pdf", lambda db, data, group_by: finance_pack.timesheets_pdf(db, data)),
    ("activities", "xlsx"): (XLSX, lambda db, data, group_by: finance_pack.activities_xlsx(data, group_by)),
    ("activities", "pdf"): ("application/pdf", lambda db, data, group_by: finance_pack.activities_pdf(data, group_by)),
    ("summary", "xlsx"): (XLSX, lambda db, data, group_by: payment_forms.xlsx_file(finance_pack.form(data))),
    ("summary", "pdf"): ("application/pdf", lambda db, data, group_by: payment_forms.pdf_file(finance_pack.form(data))),
    ("import", "xlsx"): (XLSX, lambda db, data, group_by: finance_pack.import_xlsx(data)),
    ("import", "csv"): ("text/csv; charset=utf-8", lambda db, data, group_by: finance_pack.import_csv(data)),
}


@router.get("/download")
def download(what: Literal["timesheets", "activities", "summary", "import"], format: Literal["pdf", "xlsx", "csv"],
             work_type: Literal["PAYROLL", "SERVICES"], month: str = Query(pattern=MONTH),
             region_id: Optional[int] = Query(default=None, gt=0), facility_id: Optional[int] = Query(default=None, gt=0),
             staff_id: Optional[int] = Query(default=None, gt=0), cadre_id: Optional[int] = Query(default=None, gt=0),
             group_by: Literal["person", "facility", "region", "cadre", "all"] = "person",
             db: Session = Depends(get_db), current=Depends(FINANCE)):
    if (what, format) not in FILES:
        raise HTTPException(422, "This download is not available in that format.")
    data = _selection(db, current, work_type, month, region_id, facility_id, staff_id, cadre_id)
    if not data["people"]:
        raise HTTPException(404, "Nobody is in this selection for the month.")
    media, build = FILES[(what, format)]
    payload = build(db, data, group_by)
    audit.record(db, current, "finance_download", f"{work_type}:{month}", f"download_{what}",
                 after={"format": format, "region_id": region_id, "facility_id": facility_id, "staff_id": staff_id,
                        "cadre_id": cadre_id, "group_by": group_by if what == "activities" else None,
                        "people": len(data["people"]), "bank_or_phone": what in ("timesheets", "summary", "import")})
    db.commit()
    place = "-".join(filter(None, (data["region"], data["facility"], data["cadre"]))).lower().replace(" ", "-") or "all"
    name = f"{work_type.lower()}-{what}{'-by-' + group_by if what == 'activities' else ''}-{month}-{place}.{format}"
    return Response(payload, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"',
                                                        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
