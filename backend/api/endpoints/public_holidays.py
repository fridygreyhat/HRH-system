"""Fixed holidays are built in. Administrators add the ones announced each year, such as Eid."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...core import audit
from ...core.roles import CENTRAL_ADMIN, SYSTEM_ADMIN
from ...core.security import get_current_user, require_roles
from ...db.session import get_db
from ...models import PublicHoliday
from ...services import public_holidays as holidays

router = APIRouter()


class HolidayIn(BaseModel):
    holiday_date: date
    name_en: str = Field(min_length=1, max_length=100, pattern=r"\S")
    name_sw: str = Field(min_length=1, max_length=100, pattern=r"\S")


@router.get("")
def list_holidays(year: int = Query(ge=2000, le=2100), db: Session = Depends(get_db), _=Depends(get_current_user)):
    return holidays.between(db, date(year, 1, 1), date(year, 12, 31))


@router.post("", status_code=201)
def add_holiday(body: HolidayIn, db: Session = Depends(get_db), current=Depends(require_roles(CENTRAL_ADMIN, SYSTEM_ADMIN))):
    if not 2000 <= body.holiday_date.year <= 2100:
        raise HTTPException(422, "Choose a date between 2000 and 2100.")
    taken = holidays.between(db, body.holiday_date, body.holiday_date)
    if taken:
        raise HTTPException(409, f"{body.holiday_date} is already a holiday: {taken[0]['name_en']}.")
    row = PublicHoliday(holiday_date=body.holiday_date, name_en=body.name_en.strip(), name_sw=body.name_sw.strip(), created_by=current.id)
    db.add(row)
    db.flush()
    audit.record(db, current, "public_holiday", row.id, "add", after={"date": str(row.holiday_date), "name_en": row.name_en, "name_sw": row.name_sw})
    db.commit()
    return {"id": row.id, "date": row.holiday_date.isoformat(), "name_en": row.name_en, "name_sw": row.name_sw}


@router.delete("/{holiday_id}")
def remove_holiday(holiday_id: int, db: Session = Depends(get_db), current=Depends(require_roles(CENTRAL_ADMIN, SYSTEM_ADMIN))):
    row = db.get(PublicHoliday, holiday_id)
    if row is None:
        raise HTTPException(404, "Holiday not found.")
    audit.record(db, current, "public_holiday", row.id, "remove", before={"date": str(row.holiday_date), "name_en": row.name_en})
    db.delete(row)
    db.commit()
    return {"removed": holiday_id}
