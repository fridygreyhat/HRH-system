"""The provider-owned direct community path, with no client-selectable workflow version."""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core.roles import PROVIDER
from ...core.security import CurrentUser, require_roles
from ...core.serialize import to_dict
from ...db.session import get_db
from ...models import ClaimCategory, Organization, PaymentClaim, PaymentRoute, PayPeriod, Region, utcnow
from ...services import claims as cl, community_claims as cc
from ...services.scope import assignment_for_period
from .claims import _detail

router = APIRouter()


class EditIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    declared_units: dict[str, Decimal] = Field(default_factory=dict)
    description: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("declared_units")
    @classmethod
    def finite_units(cls, values):
        if len(values) > 50 or any(not v.is_finite() or v < 0 or v > 1000000000 for v in values.values()):
            raise ValueError("Enter finite, non-negative units within the supported limit")
        return values


class CreateIn(EditIn):
    period_id: int = Field(gt=0)
    category_id: int = Field(gt=0)


def _quote_out(result):
    _, _, assignment, _, line, components, amount, currency = result
    return {"amount": amount, "currency": currency, "components": components, "budget_line_id": None,
            "payor_id": assignment.organization_id}


@router.get("/options")
def options(period_id: Optional[int] = None, db: Session = Depends(get_db),
            current: CurrentUser = Depends(require_roles(PROVIDER))):
    staff = cc.provider(current)
    periods = [to_dict(p) for p in db.query(PayPeriod).filter_by(status="OPEN").order_by(PayPeriod.start_date.desc())
               if assignment_for_period(db, staff.id, p)]
    # Do not offer a global period that would circumvent an open OR closed regional schedule.
    visible = []
    for row in periods:
        try:
            cc.context(db, current, row["id"])
            visible.append(row)
        except HTTPException:
            continue
    if period_id is None:
        return {"periods": visible, "categories": []}
    staff, period, assignment, _ = cc.context(db, current, period_id)
    categories = db.query(ClaimCategory).join(PaymentRoute).filter(
        PaymentRoute.code == "C", ClaimCategory.origin_channel == "COMMUNITY",
        ClaimCategory.requires_work_log.is_(False), ClaimCategory.is_active.is_(True),
    ).order_by(ClaimCategory.name)
    result = []
    for category in categories:
        try:
            fields = cc.unit_fields([{"unit_type": r.unit_type, "measure_key": r.measure_key}
                                     for r in cc.approved_rules(db, category, staff, period, assignment)])
            error = None
        except HTTPException as exc:
            fields, error = [], exc.detail
        result.append({"id": category.id, "name": category.name, "unit_fields": fields, "configuration_error": error})
    return {"periods": visible, "categories": result}


@router.post("/preview")
def preview(body: CreateIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(PROVIDER))):
    result = cc.quote(db, current, body.period_id, body.category_id, body.declared_units)
    return {**_quote_out(result), "payor_name": db.get(Organization, result[2].organization_id).name,
            "region_name": db.get(Region, result[2].region_id).name}


@router.post("", status_code=201)
def create(body: CreateIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(PROVIDER))):
    staff, period, assignment, category, line, components, amount, currency = cc.quote(
        db, current, body.period_id, body.category_id, body.declared_units,
    )
    claim = PaymentClaim(
        workflow_version=2, work_type="COMMUNITY", route_code="C", origin_channel="COMMUNITY",
        staff_id=staff.id, category_id=category.id, period_id=period.id, assignment_id=assignment.id,
        community_area_id=assignment.community_area_id, created_by=current.id,
        funding_source_id=category.funding_source_id, payor_org_id=assignment.organization_id,
        executor_org_id=assignment.organization_id, budget_line_id=None,
        declared_units=jsonable_encoder(body.declared_units), evidence_text=body.description,
        amount=amount, currency=currency, status=cl.DRAFT,
        calculation_snapshot=jsonable_encoder({
            "kind": "DIRECT_COMMUNITY", "cadre_id": staff.cadre_id, "region_id": assignment.region_id,
            "route": "C", "payor_org_id": assignment.organization_id, "executor_org_id": assignment.organization_id,
            "budget_line_id": None, "components": components, "amount": amount,
            "payment_policy": "APPROVED_AMOUNTS_NO_BUDGET",
            "captured_at": utcnow(), "authorized_at": None,
        }),
    )
    db.add(claim)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A live claim already exists for this provider, category and pay period")
    cc.save_components(db, claim, components)
    cl.audit(db, current, claim, "create_community", PROVIDER, None, None,
             details={"rates_captured": True, "direct_path": True})
    db.commit()
    return _detail(db, current, claim)


@router.put("/{claim_id}")
def edit(claim_id: int, body: EditIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(PROVIDER))):
    cc.provider(current)
    claim = db.query(PaymentClaim).filter_by(id=claim_id, staff_id=current.staff_id, created_by=current.id).with_for_update().first()
    if not claim or not cc.is_direct(claim):
        raise HTTPException(404, "Community claim not found")
    if claim.status not in {cl.DRAFT, cl.VALIDATION_NEEDED}:
        raise HTTPException(409, "Submitted community claims are locked; a reviewer must return the claim before it can be edited")
    cc.context(db, current, claim.period_id, claim.category_id)
    cc.check_authority(db, claim)
    snapshot = claim.calculation_snapshot
    components, amount, currency = cc.calculate(snapshot["components"], body.declared_units)
    claim.declared_units, claim.evidence_text = jsonable_encoder(body.declared_units), body.description
    claim.amount, claim.currency = amount, currency
    claim.calculation_snapshot = jsonable_encoder({**snapshot, "components": components, "amount": amount})
    claim.verified_by, claim.verified_at, claim.approved_by, claim.approved_at = None, None, None, None
    cc.save_components(db, claim, components)
    cl.audit(db, current, claim, "edit_community", PROVIDER, claim.status, claim.payment_status,
             details={"rates_retained": True})
    db.commit()
    return _detail(db, current, claim)
