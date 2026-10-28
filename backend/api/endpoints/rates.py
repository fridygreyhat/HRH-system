"""Technical Officers create scoped, immutable activity/rate versions."""
import uuid
from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...core import audit
from ...core.roles import TECHNICAL_OFFICER, RPM, REGIONAL_FINANCE, OVERSIGHT
from ...core.security import get_current_user, require_roles
from ...db.session import get_db
from ...models import ActivityRate, Cadre, Region
from ...services.activity_catalog import builtins, definition_out
from ...services.v22_scope import may_manage, regions_for

router = APIRouter()


class RateIn(BaseModel):
    label_en: str = Field(min_length=2, max_length=255)
    label_sw: str = Field(min_length=2, max_length=255)
    cadre_id: int
    region_id: int
    item_type: Literal["SERVICES", "PAYROLL"]
    form_mode: Literal["CASCADE", "SINGLE"]
    template_key: Optional[str] = None
    rate_value: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    currency: Literal["TZS"] = "TZS"
    unit_type: Literal["PER_UNIT", "PER_HOUR", "PER_DAY"]
    effective_start_date: date
    billable_index: Optional[int] = Field(default=None, ge=0)


class RevisionIn(BaseModel):
    rate_value: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    effective_start_date: date


def _scope(query, current):
    return query if current.unrestricted else query.filter(ActivityRate.region_id.in_(regions_for(current)), ActivityRate.cadre_id.in_(current.review_cadres))


@router.get("")
def list_rates(db: Session = Depends(get_db), current=Depends(require_roles(TECHNICAL_OFFICER, RPM, REGIONAL_FINANCE, OVERSIGHT))):
    return [definition_out(row) for row in _scope(db.query(ActivityRate), current).order_by(ActivityRate.created_at.desc()).all()]


@router.get("/templates")
def templates(db: Session = Depends(get_db), current=Depends(require_roles(TECHNICAL_OFFICER, RPM, REGIONAL_FINANCE, OVERSIGHT))):
    cadres = db.query(Cadre).filter(Cadre.is_active.is_(True))
    regions = db.query(Region)
    if not current.unrestricted:
        cadres = cadres.filter(Cadre.id.in_(current.review_cadres))
        regions = regions.filter(Region.id.in_(regions_for(current)))
    cadres = cadres.all()
    return {
        "cadres": [{"id": c.id, "code": c.code, "name": c.name} for c in cadres],
        "regions": [{"id": r.id, "name": r.name} for r in regions.all()],
        "templates": [item for cadre in cadres for item in builtins(db, cadre.id)],
    }


@router.post("", status_code=201)
def create_rate(body: RateIn, db: Session = Depends(get_db), current=Depends(require_roles(TECHNICAL_OFFICER))):
    if not may_manage(current, body.region_id, body.cadre_id):
        raise HTTPException(403, "Activity rates are restricted to your assigned Region × Cadre")
    if not db.get(Cadre, body.cadre_id) or not db.get(Region, body.region_id):
        raise HTTPException(422, "Unknown cadre or region")
    if body.item_type == "PAYROLL":
        raise HTTPException(422, "Payroll timesheet rates have been removed. Configure fixed daily Services amounts instead.")
    if body.unit_type != "PER_DAY":
        raise HTTPException(422, "Services use a fixed amount per service per day (PER_DAY).")
    key = "activity_" + uuid.uuid4().hex[:24]
    fields, hours_input, billable = [], body.item_type == "PAYROLL", None
    if body.template_key:
        template = next((item for item in builtins(db, body.cadre_id) if item["key"] == body.template_key and item["item_type"] == body.item_type), None)
        if not template:
            raise HTTPException(422, "Template does not match the selected cadre and item type")
        fields, hours_input = template["field_definitions"], template["hours_input"]
        mode = template["form_mode"]
    else:
        mode = body.form_mode
        if not hours_input:
            labels = ("Appointments", "Reached / tested", "New positives", "Linked to care") if mode == "CASCADE" else ("Count",)
            fields = [{"key": f"{key}_{index}", "label_en": label, "label_sw": label, "field_type": "INTEGER"} for index, label in enumerate(labels)]
    if fields:
        if body.unit_type == "PER_UNIT" and mode == "CASCADE" and body.billable_index is None:
            raise HTTPException(422, "Select the billable cascade indicator explicitly; rates never assume which outcome is payable")
        index = body.billable_index if body.billable_index is not None else 0
        if index >= len(fields):
            raise HTTPException(422, "The selected billable indicator is not on this activity")
        billable = fields[index]["key"]
    if body.unit_type == "PER_UNIT" and not billable:
        raise HTTPException(422, "A per-unit rate requires a count indicator")
    if body.unit_type == "PER_DAY":
        billable = None
    row = ActivityRate(**body.model_dump(exclude={"template_key", "form_mode", "billable_index"}), key=key, source_key=body.template_key, form_mode=mode,
                       field_definitions=fields, hours_input=hours_input, billable_field=billable, created_by=current.id)
    db.add(row)
    db.flush()
    audit.record(db, current, "activity_rate", row.id, "create", after=definition_out(row))
    db.commit()
    return definition_out(row)


@router.post("/{rate_id}/revise", status_code=201)
def revise_rate(rate_id: int, body: RevisionIn, db: Session = Depends(get_db), current=Depends(require_roles(TECHNICAL_OFFICER))):
    old = db.query(ActivityRate).filter(ActivityRate.id == rate_id).with_for_update().first()
    if not old:
        raise HTTPException(404, "Activity rate not found")
    if old.item_type == "PAYROLL":
        raise HTTPException(422, "Payroll timesheet rates have been removed; historical rates are read-only.")
    if not may_manage(current, old.region_id, old.cadre_id):
        raise HTTPException(403, "Activity rate is outside your Region × Cadre")
    if not old.is_active:
        raise HTTPException(409, "This activity version is already superseded")
    if body.effective_start_date < old.effective_start_date:
        raise HTTPException(422, "A revision cannot become effective before the version it replaces")
    old.is_active = False
    values = {column: getattr(old, column) for column in (
        "label_en", "label_sw", "cadre_id", "region_id", "item_type", "form_mode",
        "field_definitions", "hours_input", "currency", "unit_type", "billable_field", "source_key",
    )}
    values["unit_type"] = "PER_DAY"
    values["billable_field"] = None
    row = ActivityRate(**values, key="activity_" + uuid.uuid4().hex[:24], rate_value=body.rate_value,
                       effective_start_date=body.effective_start_date, created_by=current.id, supersedes_id=old.id)
    db.add(row)
    db.flush()
    audit.record(db, current, "activity_rate", row.id, "revise", after=definition_out(row), reason="New immutable rate version")
    db.commit()
    return definition_out(row)
