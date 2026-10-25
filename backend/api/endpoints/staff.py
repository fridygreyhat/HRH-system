from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.roles import CENTRAL_ADMIN, CSO_FINANCE, FHI360_FINANCE, PROVIDER, REGIONAL_ADMIN, SYSTEM_ADMIN
from ...core.security import CurrentUser, get_current_user, hash_password, require_roles
from ...core.serialize import mask_phone, to_dict
from ...core.timeutil import local_today
from ...db.session import get_db
from ...models import Cadre, District, Facility, Role, RosterImport, Section, Staff, StaffAssignment, StaffChangeRequest, User, UserRole, Ward
from ...services import staff_registry as reg
from ...services.forms import assignment_out
from ...services.scope import current_assignment, staff_visibility

router = APIRouter()
ADMINS = (CENTRAL_ADMIN, REGIONAL_ADMIN)


class AssignmentIn(BaseModel):
    region_id: int
    district_id: Optional[int] = None
    ward_id: Optional[int] = None
    facility_id: Optional[int] = None
    # Facilities are typed by hand; the name is matched within the ward or registered there.
    facility_name: Optional[str] = Field(default=None, max_length=255)
    community_area_id: Optional[int] = None
    section: Optional[str] = None
    organization_id: Optional[int] = None


class StaffCreate(BaseModel):
    cadre_id: int
    first_name: str = Field(min_length=1, max_length=100)
    middle_name: Optional[str] = Field(default=None, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    verified_phone: str = Field(pattern=r"^\+?\d{9,15}$")
    occupation: Optional[str] = None
    occupation_other: Optional[str] = None
    salary_scale: Optional[str] = None
    employment_start_date: date
    enrollment_source: str = Field(default="MANUAL", pattern="^(ROSTER_IMPORT|ENGAGEMENT_LIST|MANUAL)$")
    payment_method: Optional[str] = None
    payment_provider: Optional[str] = None
    payment_account: Optional[str] = None
    assignment: AssignmentIn


class StaffUpdate(BaseModel):
    changes: dict
    reason: str = Field(min_length=3, max_length=1000)


class RotateIn(BaseModel):
    effective_date: date
    reason: str = Field(min_length=3, max_length=1000)
    assignment: AssignmentIn


class ExitIn(BaseModel):
    end_date: date
    reason: str = Field(min_length=3, max_length=1000)


class LoginIn(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    temporary_password: str = Field(min_length=8, max_length=72)


class DecisionIn(BaseModel):
    approve: bool
    comment: Optional[str] = Field(default=None, max_length=1000)


def _admin_region_ok(current: CurrentUser, region_id: Optional[int]) -> bool:
    return CENTRAL_ADMIN in current.roles or (REGIONAL_ADMIN in current.roles and region_id in current.scope_values("region_id"))


def _get(db: Session, current: CurrentUser, staff_id: int) -> Staff:
    staff = db.query(Staff).filter(Staff.id == staff_id, staff_visibility(current)).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")
    return staff


def _sees_contact(current: CurrentUser) -> bool:
    return current.has_any(CENTRAL_ADMIN, REGIONAL_ADMIN, SYSTEM_ADMIN, FHI360_FINANCE, CSO_FINANCE)


def _summary(db: Session, current: CurrentUser, s: Staff) -> dict:
    a = current_assignment(db, s.id, local_today())
    return {
        "id": s.id,
        "legal_name": s.legal_name,
        "cadre": db.get(Cadre, s.cadre_id).code,
        "occupation": s.occupation,
        "status": s.status,
        "phone": s.verified_phone if _sees_contact(current) else mask_phone(s.verified_phone),
        "has_login": s.user_id is not None,
        "enrollment_source": s.enrollment_source,
        "current_assignment": assignment_out(db, a),
    }


def _check_admin_for_staff(db: Session, current: CurrentUser, staff: Staff) -> None:
    a = current_assignment(db, staff.id, local_today()) or db.query(StaffAssignment).filter(StaffAssignment.staff_id == staff.id).order_by(StaffAssignment.start_date.desc()).first()
    if not _admin_region_ok(current, a.region_id if a else None):
        raise HTTPException(status_code=403, detail="This staff member is outside your administrative region")


def _assignment_columns(db: Session, body: AssignmentIn) -> dict:
    """Check the placement hangs together and turn a typed facility name into its facility row."""
    if body.section and not db.get(Section, body.section):
        raise HTTPException(status_code=422, detail="Unknown section")
    district = db.get(District, body.district_id) if body.district_id else None
    if body.district_id and (not district or district.region_id != body.region_id):
        raise HTTPException(status_code=422, detail="The district is not in the chosen region")
    ward = db.get(Ward, body.ward_id) if body.ward_id else None
    if body.ward_id and (not ward or not district or ward.district_id != district.id):
        raise HTTPException(status_code=422, detail="The ward is not in the chosen district")
    columns = body.model_dump(exclude={"facility_name"})
    name = (body.facility_name or "").strip()
    if name:
        if not ward:
            raise HTTPException(status_code=422, detail="Choose the district and ward before entering the facility name")
        columns["facility_id"] = reg.facility_for_name(db, ward.id, name).id
    elif body.facility_id:
        facility = db.get(Facility, body.facility_id)
        if not facility or (body.ward_id and facility.ward_id != body.ward_id):
            raise HTTPException(status_code=422, detail="The facility is not in the chosen ward")
    return columns


@router.get("")
def list_staff(
    search: Optional[str] = None,
    status: Optional[str] = None,
    cadre: Optional[str] = None,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    query = db.query(Staff).filter(staff_visibility(current))
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(or_(Staff.first_name.ilike(like), Staff.last_name.ilike(like), Staff.verified_phone.ilike(like)))
    if status:
        query = query.filter(Staff.status == status)
    if cadre:
        query = query.join(Cadre, Cadre.id == Staff.cadre_id).filter(Cadre.code == cadre)
    return [_summary(db, current, s) for s in query.order_by(Staff.last_name, Staff.first_name).limit(500)]


@router.get("/imports")
def list_imports(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*ADMINS))):
    return [to_dict(r) for r in db.query(RosterImport).order_by(RosterImport.id.desc()).limit(50)]


@router.post("/import", status_code=201)
async def import_roster(
    file: UploadFile = File(...),
    enrollment_source: str = Form("ROSTER_IMPORT"),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_roles(*ADMINS)),
):
    if enrollment_source not in ("ROSTER_IMPORT", "ENGAGEMENT_LIST"):
        raise HTTPException(status_code=422, detail="enrollment_source must be ROSTER_IMPORT or ENGAGEMENT_LIST")
    content = (await file.read()).decode("utf-8-sig", errors="replace")
    allowed = None if CENTRAL_ADMIN in current.roles else current.scope_values("region_id")
    result = reg.import_roster(db, current, file.filename or "roster.csv", content, enrollment_source, allowed)
    db.commit()
    return to_dict(result)


@router.get("/import-template")
def import_template():
    return {"columns": reg.ROSTER_COLUMNS, "required": ["first_name", "last_name", "phone", "cadre", "region", "start_date"]}


@router.get("/change-requests")
def change_requests(status: str = "PENDING", db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*ADMINS, CSO_FINANCE))):
    query = db.query(StaffChangeRequest).filter(StaffChangeRequest.status == status)
    if not current.has_any(*ADMINS):
        query = query.filter(StaffChangeRequest.requested_by == current.id)
    out = []
    for r in query.order_by(StaffChangeRequest.id.desc()).limit(200):
        staff = db.get(Staff, r.staff_id)
        out.append({**to_dict(r), "staff_name": staff.legal_name, "requested_by_name": db.get(User, r.requested_by).full_name})
    return out


@router.post("/change-requests/{request_id}/decide")
def decide(request_id: int, body: DecisionIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*ADMINS))):
    request = db.query(StaffChangeRequest).filter(StaffChangeRequest.id == request_id).with_for_update().first()
    if not request:
        raise HTTPException(status_code=404, detail="Request not found")
    _check_admin_for_staff(db, current, db.get(Staff, request.staff_id))
    reg.decide_change_request(db, current, request, body.approve, body.comment)
    db.commit()
    return to_dict(request)


def new_staff_record(db: Session, current: CurrentUser, body: StaffCreate) -> Staff:
    """Register one staff identity with its first assignment (flushed, not committed). Shared with user enrollment."""
    if not db.get(Cadre, body.cadre_id):
        raise HTTPException(status_code=422, detail="Unknown cadre")
    if body.payment_method not in (None, "MOBILE_WALLET", "BANK"):
        raise HTTPException(status_code=422, detail="payment_method must be MOBILE_WALLET or BANK")
    reg.check_payment_method(db, body.cadre_id, body.payment_method)
    assignment = _assignment_columns(db, body.assignment)
    if db.query(Staff).filter(Staff.verified_phone == body.verified_phone).first():
        raise HTTPException(status_code=409, detail="A staff member with this phone already exists. Use a rotation instead of creating a second identity.")
    staff = Staff(**body.model_dump(exclude={"assignment"}), created_by=current.id)
    db.add(staff)
    db.flush()
    db.add(StaffAssignment(staff_id=staff.id, start_date=body.employment_start_date, created_by=current.id, **assignment))
    system_audit.record(db, current, "staff", staff.id, "create", after=body.model_dump(exclude={"payment_account"}))
    return staff


@router.post("", status_code=201)
def create_staff(body: StaffCreate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*ADMINS))):
    if not _admin_region_ok(current, body.assignment.region_id):
        raise HTTPException(status_code=403, detail="That region is outside your administrative scope")
    staff = new_staff_record(db, current, body)
    db.commit()
    return _summary(db, current, staff)


@router.get("/{staff_id}")
def get_staff(staff_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    from ...services import provider_payment_details as pd
    staff = _get(db, current, staff_id)
    assignments = db.query(StaffAssignment).filter(StaffAssignment.staff_id == staff.id).order_by(StaffAssignment.start_date.desc()).all()
    admin_in_scope = CENTRAL_ADMIN in current.roles or (
        REGIONAL_ADMIN in current.roles and any(a.region_id in current.scope_values("region_id") for a in assignments)
    )
    visible = pd.visible_details(db, current, staff)
    sees_payment = len(visible) > 1 or admin_in_scope
    own_profile = current.staff_id == staff.id
    legacy_allowed = own_profile or admin_in_scope or (
        staff.payment_method == "BANK" and "bank_account_number" in visible
    ) or (staff.payment_method == "MOBILE_WALLET" and "mobile_money_number" in visible)
    legacy_values = {key: getattr(staff, key) for key in pd.LEGACY_FIELDS}
    if legacy_allowed:
        effective = pd.details(staff)
        legacy_values["payment_account"] = (effective["bank_account_number"] if staff.payment_method == "BANK"
                                            else effective["mobile_money_number"])
        if staff.payment_method == "BANK":
            legacy_values["payment_provider"] = effective["bank_name"]
    out = {
        **to_dict(staff, exclude=(*pd.FIELDS, *pd.LEGACY_FIELDS, "payment_details_updated_at")),
        **{key: value for key, value in visible.items() if key != "staff_id"},
        **(legacy_values if legacy_allowed else {}),
        "legal_name": staff.legal_name,
        "cadre": db.get(Cadre, staff.cadre_id).code,
        "verified_phone": staff.verified_phone if _sees_contact(current) or current.staff_id == staff.id else mask_phone(staff.verified_phone),
        "assignments": [{**assignment_out(db, a), "end_reason": a.end_reason, "is_primary": a.is_primary} for a in assignments],
        "username": db.get(User, staff.user_id).username if staff.user_id else None,
    }
    if sees_payment and not own_profile:
        system_audit.record(db, current, "staff", staff.id, "view_payment_details")
        db.commit()
    return out


@router.patch("/{staff_id}")
def update_staff(staff_id: int, body: StaffUpdate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*ADMINS, CSO_FINANCE))):
    """HRH admins change staff directly. CSO edits to payment-critical fields become change requests for HRH approval."""
    staff = _get(db, current, staff_id)
    if current.has_any(*ADMINS):
        _check_admin_for_staff(db, current, staff)
        reg.update_staff(db, current, staff, body.changes, body.reason)
        db.commit()
        return {"applied": True, "staff": _summary(db, current, staff)}
    critical = {k: v for k, v in body.changes.items() if k in reg.PAYMENT_CRITICAL_FIELDS}
    direct = {k: v for k, v in body.changes.items() if k not in reg.PAYMENT_CRITICAL_FIELDS}
    if direct:
        reg.update_staff(db, current, staff, direct, body.reason)
    request = reg.request_change(db, current, staff, critical, body.reason) if critical else None
    db.commit()
    return {"applied": bool(direct), "change_request_id": request.id if request else None, "staff": _summary(db, current, staff)}


@router.post("/{staff_id}/rotate")
def rotate(staff_id: int, body: RotateIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*ADMINS))):
    staff = _get(db, current, staff_id)
    _check_admin_for_staff(db, current, staff)
    if not _admin_region_ok(current, body.assignment.region_id):
        raise HTTPException(status_code=403, detail="The new region is outside your administrative scope")
    reg.rotate(db, current, staff, _assignment_columns(db, body.assignment), body.effective_date, body.reason)
    db.commit()
    return get_staff(staff_id, db, current)


@router.post("/{staff_id}/exit")
def exit_staff(staff_id: int, body: ExitIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*ADMINS))):
    staff = _get(db, current, staff_id)
    _check_admin_for_staff(db, current, staff)
    if staff.status == "EXITED":
        raise HTTPException(status_code=409, detail="Already exited")
    reg.exit_staff(db, current, staff, body.end_date, body.reason)
    db.commit()
    return get_staff(staff_id, db, current)


@router.post("/{staff_id}/login", status_code=201)
def create_login(staff_id: int, body: LoginIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    """Give a staff member a provider account (system administrators manage accounts)."""
    staff = db.get(Staff, staff_id)
    if not staff:
        raise HTTPException(status_code=404, detail="Staff member not found")
    if staff.user_id:
        raise HTTPException(status_code=409, detail="This staff member already has a login")
    user = User(username=body.username, hashed_password=hash_password(body.temporary_password), full_name=staff.legal_name,
                phone=staff.verified_phone, must_change_password=True)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or phone already used by another account")
    db.add(UserRole(user_id=user.id, role_id=db.query(Role).filter(Role.name == PROVIDER).one().id, assigned_by=current.id))
    staff.user_id = user.id
    system_audit.record(db, current, "user", user.id, "create_for_staff", after={"staff_id": staff.id, "username": user.username, "roles": [PROVIDER]})
    db.commit()
    return {"user_id": user.id, "username": user.username}
