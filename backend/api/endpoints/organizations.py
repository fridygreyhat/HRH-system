"""CSO setup and auditable regional payment authority."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, PositiveInt, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core import audit
from ...core.roles import CENTRAL_ADMIN, CSO_FINANCE, FHI360_FINANCE, OVERSIGHT, REGIONAL_FINANCE, RPM
from ...core.security import CurrentUser, require_roles
from ...core.serialize import to_dict
from ...db.session import get_db
from ...models import CSORegionAssignment, Organization, Region
from ...services.v22_scope import regions_for

router = APIRouter()
READ_ROLES = (CENTRAL_ADMIN, CSO_FINANCE, FHI360_FINANCE, OVERSIGHT, REGIONAL_FINANCE, RPM)


class OrganizationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)
    code: Optional[str] = Field(default=None, max_length=50)
    type: Literal["CSO", "PARTNER"] = "CSO"
    is_active: bool = True
    region_ids: list[PositiveInt] = Field(default_factory=list, max_length=100)

    @field_validator("region_ids")
    @classmethod
    def unique_regions(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Select each region only once")
        return value

    @field_validator("name", "code")
    @classmethod
    def strip_text(cls, value):
        if value is not None:
            value = value.strip()
        if value == "":
            raise ValueError("A name or code cannot be blank")
        return value


class AssignmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    organization_id: int
    region_id: int
    is_active: bool = True


def _global(current):
    return current.unrestricted or current.has_any(CENTRAL_ADMIN, FHI360_FINANCE, OVERSIGHT)


def _queries(db, current):
    organizations = db.query(Organization)
    regions = db.query(Region)
    assignments = db.query(CSORegionAssignment)
    if not _global(current):
        if current.has_any(CSO_FINANCE):
            ids = current.scope_values("organization_id")
            organizations = organizations.filter(Organization.id.in_(ids))
            assignments = assignments.filter(CSORegionAssignment.organization_id.in_(ids))
            regions = regions.filter(Region.id.in_(
                db.query(CSORegionAssignment.region_id).filter(CSORegionAssignment.organization_id.in_(ids))
            ))
        else:
            ids = regions_for(current)
            regions = regions.filter(Region.id.in_(ids))
            assignments = assignments.filter(CSORegionAssignment.region_id.in_(ids))
            organizations = organizations.filter(Organization.id.in_(
                db.query(CSORegionAssignment.organization_id).filter(CSORegionAssignment.region_id.in_(ids))
            ))
    return organizations, regions, assignments


def _assignment_out(db, row):
    return {**to_dict(row), "organization_name": db.get(Organization, row.organization_id).name,
            "region_name": db.get(Region, row.region_id).name}


@router.get("")
def overview(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*READ_ROLES))):
    organizations, regions, assignments = _queries(db, current)
    return {"organizations": [to_dict(o) for o in organizations.order_by(Organization.name)],
            "regions": [to_dict(r) for r in regions.order_by(Region.name)],
            "assignments": [_assignment_out(db, a) for a in assignments.order_by(CSORegionAssignment.organization_id, CSORegionAssignment.region_id)],
            "can_manage": current.has_any(CENTRAL_ADMIN)}


@router.post("/create-org", status_code=201)
def create_org(body: OrganizationIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN))):
    if body.region_ids:
        if body.type != "CSO" or not body.is_active:
            raise HTTPException(422, "Regional payment assignments require an active CSO")
        known = {region.id for region in db.query(Region).filter(Region.id.in_(body.region_ids))}
        if known != set(body.region_ids):
            raise HTTPException(422, "One or more selected regions do not exist; reload the regions and try again")
    row = Organization(**body.model_dump(exclude={"region_ids"}))
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An organization with this name or code already exists")
    audit.record(db, current, "organizations", row.id, "create", after=to_dict(row))
    for region_id in body.region_ids:
        assignment = CSORegionAssignment(organization_id=row.id, region_id=region_id, is_active=True)
        db.add(assignment)
        db.flush()
        audit.record(db, current, "cso_region_assignment", assignment.id, "create", after=to_dict(assignment))
    db.commit()
    return to_dict(row)


@router.post("/assign-cso-region")
def assign_region(body: AssignmentIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN))):
    # Serializes duplicate assignment creation, changes of authority and budget setup.
    org = db.query(Organization).filter_by(id=body.organization_id).with_for_update().first()
    if not org or org.type != "CSO" or (body.is_active and not org.is_active):
        raise HTTPException(422, "Select an active CSO (not a Partner or FHI360)")
    if not db.get(Region, body.region_id):
        raise HTTPException(422, "Unknown region")
    row = db.query(CSORegionAssignment).filter_by(
        organization_id=org.id, region_id=body.region_id,
    ).with_for_update().first()
    before = to_dict(row) if row else None
    if row is None:
        row = CSORegionAssignment(**body.model_dump())
        db.add(row)
    else:
        row.is_active = body.is_active
    db.flush()
    audit.record(db, current, "cso_region_assignment", row.id, "update" if before else "create",
                 before=before, after=to_dict(row))
    db.commit()
    return _assignment_out(db, row)


@router.get("/cso-regions/{region_id}")
def regional_csos(region_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*READ_ROLES))):
    _, regions, assignments = _queries(db, current)
    if not regions.filter(Region.id == region_id).first():
        raise HTTPException(404, "Region not found in your scope")
    ids = assignments.filter(CSORegionAssignment.region_id == region_id, CSORegionAssignment.is_active.is_(True)).with_entities(
        CSORegionAssignment.organization_id,
    )
    return [to_dict(o) for o in db.query(Organization).filter(
        Organization.id.in_(ids), Organization.type == "CSO", Organization.is_active.is_(True),
    ).order_by(Organization.name)]
