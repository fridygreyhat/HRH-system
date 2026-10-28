"""Configuration and administration. Every change is written to the append-only audit_events table."""
from datetime import date
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, create_model
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.audit_access import AUDIT_ADMIN_ROLES
from ...core.roles import (
    ALL_ROLES,
    CENTRAL_ADMIN,
    CSO_FINANCE,
    FHI360_FINANCE,
    OVERSIGHT,
    PROVIDER,
    ROLE_DESCRIPTIONS,
    RPM,
    SUPER_ADMIN,
    SYSTEM_ADMIN,
)
from ...core.security import CurrentUser, get_current_user, get_user_roles, hash_password, load_current_user, require_roles
from ...core.serialize import mask_phone, to_dict
from ...core.settings import DEFAULTS, SETTING_DESCRIPTIONS, all_settings
from ...db.session import get_db
from ...models import (
    AuditEvent,
    Cadre,
    CadreFormField,
    ClaimCategory,
    Cluster,
    CommunityArea,
    District,
    Facility,
    FundingSource,
    Organization,
    PaymentRoute,
    PayPeriod,
    RateRule,
    Region,
    Role,
    Section,
    SMSOutbox,
    SMSTemplate,
    Staff,
    SystemSetting,
    User,
    UserReviewCadre,
    UserRole,
    UserScope,
    Ward,
    utcnow,
)
from ...services import notifications
from ...services.forms import cadre_out
from ...services.templates import EVENTS, LANGUAGES, PROTECTED_EVENTS
from .staff import StaffCreate, new_staff_record

router = APIRouter()
AUTO_COLUMNS = {"id", "created_at", "updated_at"}


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Conflicts with existing data: {e.orig.diag.message_primary if hasattr(e.orig, 'diag') else e.orig}")


def _schema(model) -> type[BaseModel]:
    fields: dict[str, Any] = {}
    for column in sa_inspect(model).columns:
        if column.key in AUTO_COLUMNS:
            continue
        py_type = column.type.python_type
        required = not column.nullable and column.default is None and not column.primary_key
        if column.primary_key:  # natural keys such as sections.code
            required = True
        fields[column.key] = (py_type, ...) if required else (Optional[py_type], None)
    return create_model(f"{model.__name__}In", **fields)


def _crud(path: str, model, write_roles: tuple[str, ...], order_by=None, pk="id") -> None:
    """List/create/update for configuration tables; any signed-in user reads, `write_roles` change."""
    schema = _schema(model)
    order = order_by if order_by is not None else getattr(model, pk)

    @router.get(f"/{path}", name=f"list_{path}")
    def list_items(db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
        return [to_dict(row) for row in db.query(model).order_by(order).all()]

    @router.post(f"/{path}", status_code=201, name=f"create_{path}")
    def create_item(item: schema, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*write_roles))):  # type: ignore[valid-type]
        row = model(**item.model_dump())
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Already exists or references unknown data")
        system_audit.record(db, current, path, getattr(row, pk), "create", after=item.model_dump())
        _commit(db)
        return to_dict(row)

    @router.put(f"/{path}/{{item_id}}", name=f"update_{path}")
    def update_item(item_id: str, item: schema, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*write_roles))):  # type: ignore[valid-type]
        row = db.get(model, int(item_id) if pk == "id" else item_id)
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        before = to_dict(row)
        for key, value in item.model_dump().items():
            if key != pk:
                setattr(row, key, value)
        system_audit.record(db, current, path, item_id, "update", before=before, after=item.model_dump())
        _commit(db)
        return to_dict(row)


_crud("organizations", Organization, (CENTRAL_ADMIN,), Organization.name)
_crud("regions", Region, (CENTRAL_ADMIN,), Region.name)
_crud("clusters", Cluster, (CENTRAL_ADMIN,), Cluster.name)
_crud("districts", District, (CENTRAL_ADMIN,), District.name)
_crud("wards", Ward, (CENTRAL_ADMIN,), Ward.name)
_crud("facilities", Facility, (CENTRAL_ADMIN,), Facility.name)
_crud("community-areas", CommunityArea, (CENTRAL_ADMIN,), CommunityArea.name)
_crud("sections", Section, (CENTRAL_ADMIN,), Section.code, pk="code")
from .pay_periods import router as pay_periods_router
router.include_router(pay_periods_router)
_crud("funding-sources", FundingSource, (FHI360_FINANCE,), FundingSource.name)
_crud("claim-categories", ClaimCategory, (FHI360_FINANCE,), ClaimCategory.name)


@router.get("/payment-routes")
def payment_routes(db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    return [to_dict(r) for r in db.query(PaymentRoute).order_by(PaymentRoute.code)]


@router.get("/roles")
def roles(_: CurrentUser = Depends(get_current_user)):
    return [{"name": name, "description": desc} for name, desc in ROLE_DESCRIPTIONS.items()]


# --- Cadre form templates ------------------------------------------------------------------


@router.get("/cadres")
def cadres(db: Session = Depends(get_db), current: CurrentUser = Depends(get_current_user)):
    """Admins also see inactive fields so they can be reviewed and re-enabled."""
    return [cadre_out(db, c, include_inactive=CENTRAL_ADMIN in current.roles) for c in db.query(Cadre).order_by(Cadre.id)]


class CadreUpdate(BaseModel):
    name: str
    form_title: Optional[str] = None
    uses_facility_geofence: bool
    requires_facility_endorsement: bool
    technical_reviewer_title: Optional[str] = Field(default=None, max_length=255)
    uses_section: bool
    occupation_options: List[str] = []
    is_active: bool = True


@router.put("/cadres/{cadre_id}")
def update_cadre(cadre_id: int, body: CadreUpdate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN))):
    cadre = db.get(Cadre, cadre_id)
    if not cadre:
        raise HTTPException(status_code=404, detail="Cadre not found")
    before = to_dict(cadre)
    for key, value in body.model_dump().items():
        setattr(cadre, key, value)
    system_audit.record(db, current, "cadre", cadre.id, "update", before=before, after=body.model_dump())
    _commit(db)
    return cadre_out(db, cadre)


class FieldIn(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{1,79}$")
    label_en: str = Field(min_length=1, max_length=255)
    label_sw: Optional[str] = Field(default=None, max_length=255)
    field_type: str = Field(default="INTEGER", pattern="^(INTEGER|BOOLEAN)$")
    sort_order: int = 0
    is_active: bool = True


@router.post("/cadres/{cadre_id}/fields", status_code=201)
def add_field(cadre_id: int, body: FieldIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN))):
    if not db.get(Cadre, cadre_id):
        raise HTTPException(status_code=404, detail="Cadre not found")
    row = CadreFormField(cadre_id=cadre_id, **body.model_dump())
    db.add(row)
    system_audit.record(db, current, "cadre_form_field", f"{cadre_id}:{body.key}", "create", after=body.model_dump())
    _commit(db)
    return to_dict(row)


@router.put("/cadres/{cadre_id}/fields/{key}")
def update_field(cadre_id: int, key: str, body: FieldIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CENTRAL_ADMIN))):
    """Labels, order and visibility may change; the key and type are fixed once data exists."""
    row = db.query(CadreFormField).filter(CadreFormField.cadre_id == cadre_id, CadreFormField.key == key).first()
    if not row:
        raise HTTPException(status_code=404, detail="Field not found")
    if body.key != key or body.field_type != row.field_type:
        raise HTTPException(status_code=422, detail="A field's key and type cannot change; add a new field and deactivate this one")
    before = to_dict(row)
    row.label_en, row.label_sw, row.sort_order, row.is_active = body.label_en, body.label_sw, body.sort_order, body.is_active
    system_audit.record(db, current, "cadre_form_field", f"{cadre_id}:{key}", "update", before=before, after=body.model_dump())
    _commit(db)
    return to_dict(row)


# --- Rate rules (maker-checker) -----------------------------------------------------------


class RateRuleIn(BaseModel):
    category_id: int
    cadre_id: Optional[int] = None
    region_id: Optional[int] = None
    component_name: str = Field(min_length=1, max_length=255)
    unit_type: str = Field(pattern="^(PER_DAY|PER_HOUR|PER_UNIT|FIXED)$")
    measure_key: Optional[str] = None
    rate_value: float = Field(ge=0)
    currency: str = "TZS"
    cap_amount: Optional[float] = Field(default=None, ge=0)
    effective_start_date: date
    effective_end_date: Optional[date] = None


class DecisionIn(BaseModel):
    comment: Optional[str] = Field(default=None, max_length=1000)


@router.get("/rate-rules")
def rate_rules(db: Session = Depends(get_db), _: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE, RPM, OVERSIGHT))):
    names = {u.id: u.full_name for u in db.query(User)}
    rows = db.query(RateRule).order_by(RateRule.category_id, RateRule.component_name, RateRule.effective_start_date.desc())
    return [{**to_dict(r), "created_by_name": names.get(r.created_by), "approved_by_name": names.get(r.approved_by)} for r in rows]


@router.post("/rate-rules", status_code=201)
def propose_rate_rule(body: RateRuleIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    """Proposed rules are inactive until approved by an RPM or oversight manager other than the proposer."""
    if body.unit_type == "PER_UNIT" and not body.measure_key:
        raise HTTPException(status_code=422, detail="PER_UNIT rules must name the work-log measure they count")
    if body.measure_key:
        query = db.query(CadreFormField.key)
        if body.cadre_id:
            query = query.filter(CadreFormField.cadre_id == body.cadre_id)
        if body.measure_key not in {k for (k,) in query}:
            where = "that cadre's form" if body.cadre_id else "any cadre form"
            raise HTTPException(status_code=422, detail=f"'{body.measure_key}' is not a field on {where}")
    if body.effective_end_date and body.effective_end_date < body.effective_start_date:
        raise HTTPException(status_code=422, detail="End date is before start date")
    rule = RateRule(**body.model_dump(), status="PENDING_APPROVAL", created_by=current.id)
    db.add(rule)
    db.flush()
    system_audit.record(db, current, "rate_rule", rule.id, "propose", after=body.model_dump())
    _commit(db)
    return to_dict(rule)


def _decide_rule(db: Session, current: CurrentUser, rule_id: int, approve: bool, comment: Optional[str]) -> RateRule:
    rule = db.query(RateRule).filter(RateRule.id == rule_id).with_for_update().first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rate rule not found")
    if rule.status != "PENDING_APPROVAL":
        raise HTTPException(status_code=409, detail=f"Rule is {rule.status}")
    if rule.created_by == current.id:
        raise HTTPException(status_code=403, detail="A rate rule must be approved by someone other than its proposer")
    rule.status = "ACTIVE" if approve else "REJECTED"
    rule.approved_by, rule.approved_at = current.id, utcnow()
    system_audit.record(db, current, "rate_rule", rule.id, "approve" if approve else "reject", reason=comment)
    _commit(db)
    return rule


@router.post("/rate-rules/{rule_id}/approve")
def approve_rate_rule(rule_id: int, body: DecisionIn = DecisionIn(), db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(RPM, OVERSIGHT))):
    return to_dict(_decide_rule(db, current, rule_id, True, body.comment))


@router.post("/rate-rules/{rule_id}/reject")
def reject_rate_rule(rule_id: int, body: DecisionIn = DecisionIn(), db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(RPM, OVERSIGHT))):
    return to_dict(_decide_rule(db, current, rule_id, False, body.comment))


class RetireIn(BaseModel):
    effective_end_date: date
    reason: str = Field(min_length=3)


@router.post("/rate-rules/{rule_id}/retire")
def retire_rate_rule(rule_id: int, body: RetireIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    """End-date an active rule. Past claims keep their authorized calculation snapshot."""
    rule = db.query(RateRule).filter(RateRule.id == rule_id).with_for_update().first()
    if not rule or rule.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Only active rules can be retired")
    if body.effective_end_date < rule.effective_start_date:
        raise HTTPException(status_code=422, detail="End date is before the rule's start")
    before = to_dict(rule)
    rule.effective_end_date = body.effective_end_date
    system_audit.record(db, current, "rate_rule", rule.id, "retire", before=before, after={"effective_end_date": body.effective_end_date}, reason=body.reason)
    _commit(db)
    return to_dict(rule)


# --- Users, roles and scopes ----------------------------------------------------------------


class ScopeIn(BaseModel):
    region_id: Optional[int] = None
    cluster_id: Optional[int] = None
    facility_id: Optional[int] = None
    community_area_id: Optional[int] = None
    organization_id: Optional[int] = None


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=72)
    full_name: str = Field(min_length=1, max_length=255)
    phone: str = Field(pattern=r"^\+?\d{9,15}$")
    email: Optional[str] = None
    preferred_language: str = Field(default="sw", pattern="^(en|sw)$")
    roles: List[str] = Field(min_length=1)
    scopes: List[ScopeIn] = []
    review_cadre_ids: List[int] = []  # technical area, for technical officers
    # A health worker (CHW, Data Clerk, HCP) is linked to a staff record: an existing one, or a new one created here.
    staff_id: Optional[int] = None
    staff: Optional[StaffCreate] = None


class StaffLinkIn(BaseModel):
    staff_id: Optional[int] = None
    staff: Optional[StaffCreate] = None


class RolesIn(BaseModel):
    roles: List[str] = Field(min_length=1)
    reason: str = Field(min_length=3)


class ScopesIn(BaseModel):
    scopes: List[ScopeIn]
    reason: str = Field(min_length=3)


class ReviewCadresIn(BaseModel):
    cadre_ids: List[int]
    reason: str = Field(min_length=3)


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=72)


class BulkPasswordReset(PasswordReset):
    confirmation: str = Field(pattern=r"^RESET NON-SUPER-ADMIN PASSWORDS$")
    expected_count: int = Field(ge=0)
    reason: str = Field(min_length=10, max_length=500)


@router.post("/user-password-reset")
def reset_non_super_admin_passwords(body: BulkPasswordReset, db: Session = Depends(get_db),
                                    current: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    users = db.query(User).order_by(User.id).with_for_update().all()
    protected = {uid for (uid,) in db.query(UserRole.user_id).join(Role, Role.id == UserRole.role_id)
                 .filter(Role.name == SUPER_ADMIN)}
    targets = [user for user in users if user.id not in protected]
    if len(targets) != body.expected_count:
        raise HTTPException(status_code=409, detail="The account list changed. Refresh Users and review the reset again.")
    for user in targets:
        user.hashed_password = hash_password(body.new_password)
        user.must_change_password = True
        user.password_changed_at = utcnow()
        user.failed_login_count, user.locked_until = 0, None
        # Keep deactivated accounts deactivated. Never include credentials in audit data.
        system_audit.record(db, current, "user", user.id, "reset_password",
                            after={"bulk": True}, reason=body.reason)
    system_audit.record(db, current, "user", None, "bulk_password_reset",
                        after={"reset_count": len(targets), "super_admins_unchanged": len(protected)}, reason=body.reason)
    _commit(db)
    return {"reset_count": len(targets), "super_admins_unchanged": len(protected)}


@router.get("/login-failures")
def login_failures(username: Optional[str] = None, limit: int = 100, db: Session = Depends(get_db),
                   _: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    query = db.query(AuditEvent).filter(AuditEvent.entity_type == "auth",
                                       AuditEvent.action.in_(("login_failed", "login_blocked")))
    if username and username.strip():
        query = query.filter(AuditEvent.after["username"].astext == username.strip())
    messages = {
        "unknown_user": "Username not found. Check the spelling or register the account.",
        "bad_password": "Incorrect password. Reset the password if needed.",
        "inactive": "Account is deactivated. Review the account before reactivating it.",
        "locked": "Account temporarily locked after repeated failed sign-ins. Reset the password or unlock it.",
    }
    rows = query.order_by(AuditEvent.id.desc()).limit(max(1, min(limit, 500))).all()
    return [{
        "id": row.id, "created_at": row.created_at, "username": (row.after or {}).get("username", ""),
        "reason": "locked" if row.action == "login_blocked" or (row.after or {}).get("locked")
                  else (row.after or {}).get("reason", "unknown"),
        "message": messages.get(
            "locked" if row.action == "login_blocked" or (row.after or {}).get("locked")
            else (row.after or {}).get("reason"), "Sign-in failed. Review this account."),
    } for row in rows]


def _user_out(db: Session, user: User) -> dict:
    cu = load_current_user(db, user)
    return {
        **to_dict(user, exclude=("hashed_password",)),
        "is_locked": bool(user.locked_until and user.locked_until > utcnow()),
        "roles": sorted(get_user_roles(db, user.id)),  # as granted; a super admin's other roles are implied
        "scopes": [to_dict(s) for s in cu.scopes],
        "review_cadre_ids": sorted(cu.review_cadres),
        "staff_id": cu.staff.id if cu.staff else None,
    }


def _guard_super_admin(db: Session, current: CurrentUser, user: User) -> None:
    """Only a super administrator may change a super administrator's account."""
    if SUPER_ADMIN in get_user_roles(db, user.id) and not current.unrestricted:
        raise HTTPException(status_code=403, detail="Only a super administrator can change a super administrator's account")


def _set_roles(db: Session, user: User, roles: list[str], actor: CurrentUser) -> None:
    unknown = set(roles) - set(ALL_ROLES)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown roles {sorted(unknown)}")
    if SUPER_ADMIN in roles and not actor.unrestricted:
        raise HTTPException(status_code=403, detail="Only a super administrator can grant the super administrator role")
    db.query(UserRole).filter(UserRole.user_id == user.id).delete()
    for role in db.query(Role).filter(Role.name.in_(roles)):
        db.add(UserRole(user_id=user.id, role_id=role.id, assigned_by=actor.id))


def _set_scopes(db: Session, user: User, scopes: list[ScopeIn], actor: CurrentUser) -> None:
    db.query(UserScope).filter(UserScope.user_id == user.id).delete()
    for s in scopes:
        if not any(s.model_dump().values()):
            raise HTTPException(status_code=422, detail="Each scope must name at least one region, cluster, facility, community area or organization")
        db.add(UserScope(user_id=user.id, created_by=actor.id, **s.model_dump()))


def _set_review_cadres(db: Session, user: User, cadre_ids: list[int], actor: CurrentUser) -> None:
    if set(cadre_ids) - {c.id for c in db.query(Cadre)}:
        raise HTTPException(status_code=422, detail="Unknown cadre in the technical area")
    db.query(UserReviewCadre).filter(UserReviewCadre.user_id == user.id).delete()
    for cadre_id in set(cadre_ids):
        db.add(UserReviewCadre(user_id=user.id, cadre_id=cadre_id, assigned_by=actor.id))


def _link_staff(db: Session, current: CurrentUser, user: User, staff_id: Optional[int], new_staff: Optional[StaffCreate]) -> Staff:
    """Link a login to its staff record and make sure it carries the provider role."""
    if bool(staff_id) == bool(new_staff):
        raise HTTPException(status_code=422, detail="Give either an existing staff record or the details of a new one")
    if db.query(Staff).filter(Staff.user_id == user.id).first():
        raise HTTPException(status_code=409, detail="This user is already linked to a staff record")
    if new_staff:
        staff = new_staff_record(db, current, new_staff)
    else:
        staff = db.query(Staff).filter(Staff.id == staff_id).with_for_update().first()
        if not staff or staff.user_id:
            raise HTTPException(status_code=409, detail="Staff record not found or already linked to a login")
    staff.user_id = user.id
    provider = db.query(Role).filter(Role.name == PROVIDER).one()
    if not db.query(UserRole).filter(UserRole.user_id == user.id, UserRole.role_id == provider.id).first():
        db.add(UserRole(user_id=user.id, role_id=provider.id, assigned_by=current.id))
    return staff


@router.get("/unlinked-staff")
def unlinked_staff(db: Session = Depends(get_db), _: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    """Active staff records without a login, for linking from the Users screen."""
    rows = db.query(Staff).filter(Staff.user_id.is_(None), Staff.status == "ACTIVE").order_by(Staff.last_name, Staff.first_name).limit(1000)
    cadres = {c.id: c.code for c in db.query(Cadre)}
    return [{"id": s.id, "legal_name": s.legal_name, "cadre": cadres.get(s.cadre_id), "phone": s.verified_phone} for s in rows]


@router.get("/users")
def list_users(db: Session = Depends(get_db), _: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    return [_user_out(db, u) for u in db.query(User).order_by(User.username)]


@router.post("/users", status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    user = User(username=body.username, hashed_password=hash_password(body.password), full_name=body.full_name, phone=body.phone,
                email=body.email, preferred_language=body.preferred_language, must_change_password=True)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or phone already in use")
    _set_roles(db, user, [r for r in body.roles if r != PROVIDER], current)
    _set_scopes(db, user, body.scopes, current)
    _set_review_cadres(db, user, body.review_cadre_ids, current)
    if body.staff_id or body.staff:
        _link_staff(db, current, user, body.staff_id, body.staff)
    elif PROVIDER in body.roles:
        raise HTTPException(status_code=422, detail="A provider account must be linked to a staff record (CHW, Data Clerk or HCP)")
    system_audit.record(db, current, "user", user.id, "create", after=body.model_dump(exclude={"password": True, "staff": {"payment_account"}}, mode="json"))
    _commit(db)
    return _user_out(db, user)


@router.post("/users/{user_id}/staff")
def link_staff(user_id: int, body: StaffLinkIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    """Link an existing login to a staff record, or register the staff record for it."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    staff = _link_staff(db, current, user, body.staff_id, body.staff)
    system_audit.record(db, current, "user", user.id, "link_staff", after={"staff_id": staff.id})
    _commit(db)
    return _user_out(db, user)


@router.put("/users/{user_id}/roles")
def set_roles(user_id: int, body: RolesIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _guard_super_admin(db, current, user)
    if user.id == current.id and not ({SYSTEM_ADMIN, SUPER_ADMIN} & set(body.roles)):
        raise HTTPException(status_code=422, detail="You cannot remove your own administrator role")
    if user.id == current.id and current.unrestricted and SUPER_ADMIN not in body.roles:
        raise HTTPException(status_code=422, detail="You cannot remove your own super administrator role")
    before = sorted(get_user_roles(db, user.id))
    _set_roles(db, user, body.roles, current)
    system_audit.record(db, current, "user_roles", user.id, "set", before={"roles": before}, after={"roles": body.roles}, reason=body.reason)
    _commit(db)
    return _user_out(db, user)


@router.put("/users/{user_id}/scopes")
def set_scopes(user_id: int, body: ScopesIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _guard_super_admin(db, current, user)
    before = [to_dict(s) for s in load_current_user(db, user).scopes]
    _set_scopes(db, user, body.scopes, current)
    system_audit.record(db, current, "user_scopes", user.id, "set", before={"scopes": before}, after={"scopes": [s.model_dump() for s in body.scopes]}, reason=body.reason)
    _commit(db)
    return _user_out(db, user)


@router.put("/users/{user_id}/review-cadres")
def set_review_cadres(user_id: int, body: ReviewCadresIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    """A technical officer's technical area: which cadres' work logs reach them for technical review."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _guard_super_admin(db, current, user)
    before = sorted(load_current_user(db, user).review_cadres)
    _set_review_cadres(db, user, body.cadre_ids, current)
    system_audit.record(db, current, "user_review_cadres", user.id, "set", before={"cadre_ids": before}, after={"cadre_ids": sorted(set(body.cadre_ids))}, reason=body.reason)
    _commit(db)
    return _user_out(db, user)


@router.post("/users/{user_id}/deactivate")
def deactivate(user_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _guard_super_admin(db, current, user)
    if user.id == current.id:
        raise HTTPException(status_code=422, detail="You cannot deactivate yourself")
    user.is_active = False
    system_audit.record(db, current, "user", user.id, "deactivate")
    _commit(db)
    return _user_out(db, user)


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    phone: str = Field(pattern=r"^\+?\d{9,15}$")
    email: Optional[str] = None
    preferred_language: str = Field(default="sw", pattern="^(en|sw)$")


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _guard_super_admin(db, current, user)
    before = to_dict(user, exclude=("hashed_password",))
    for key, value in body.model_dump().items():
        setattr(user, key, value)
    system_audit.record(db, current, "user", user.id, "update", before=before, after=body.model_dump())
    _commit(db)
    return _user_out(db, user)


@router.post("/users/{user_id}/reactivate")
def reactivate(user_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _guard_super_admin(db, current, user)
    user.is_active = True
    user.failed_login_count, user.locked_until = 0, None
    system_audit.record(db, current, "user", user.id, "reactivate")
    _commit(db)
    return _user_out(db, user)


@router.post("/users/{user_id}/reset-password", status_code=204)
def reset_password(user_id: int, body: PasswordReset, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    _guard_super_admin(db, current, user)
    # Temporary password: the user must replace it, and every existing session ends.
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = True
    user.password_changed_at = utcnow()
    user.failed_login_count, user.locked_until = 0, None
    system_audit.record(db, current, "user", user.id, "reset_password")
    _commit(db)


@router.post("/users/{user_id}/unlock")
def unlock(user_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.failed_login_count, user.locked_until = 0, None
    system_audit.record(db, current, "user", user.id, "unlock")
    _commit(db)
    return _user_out(db, user)


# --- Settings ------------------------------------------------------------------------------


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: CurrentUser = Depends(require_roles(SYSTEM_ADMIN, OVERSIGHT))):
    return [{"key": k, "value": v, "default": DEFAULTS[k], "description": SETTING_DESCRIPTIONS.get(k)} for k, v in all_settings(db).items()]


class SettingIn(BaseModel):
    value: Any
    reason: str = Field(min_length=3)


@router.put("/settings/{key}")
def put_setting(key: str, body: SettingIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN))):
    if key not in DEFAULTS:
        raise HTTPException(status_code=404, detail="Unknown setting")
    if key in {"max_daily_hours", "max_weekly_hours", "saturday_min_hours", "saturday_max_hours"}:
        if isinstance(body.value, bool) or not isinstance(body.value, (int, float)) or not 0 < body.value <= (120 if key == "max_weekly_hours" else 24):
            raise HTTPException(status_code=422, detail=f"{key} must be a number within its valid range")
        body.value = float(body.value)
        if key in {"saturday_min_hours", "saturday_max_hours"}:
            limits = all_settings(db)
            limits[key] = body.value
            if limits["saturday_min_hours"] > limits["saturday_max_hours"]:
                raise HTTPException(status_code=422, detail="Saturday minimum hours may not exceed Saturday maximum hours")
    elif type(body.value) is not type(DEFAULTS[key]):
        raise HTTPException(status_code=422, detail=f"{key} must be a {type(DEFAULTS[key]).__name__}")
    row = db.get(SystemSetting, key)
    before = row.value if row else DEFAULTS[key]
    if row:
        row.value, row.updated_by, row.updated_at = body.value, current.id, utcnow()
    else:
        db.add(SystemSetting(key=key, value=body.value, updated_by=current.id))
    system_audit.record(db, current, "setting", key, "update", before={"value": before}, after={"value": body.value}, reason=body.reason)
    _commit(db)
    return {"key": key, "value": body.value}


# --- SMS templates and outbox -------------------------------------------------------------

TEMPLATE_EDITORS = (RPM, OVERSIGHT)


@router.get("/sms-templates")
def sms_templates(db: Session = Depends(get_db), _: CurrentUser = Depends(require_roles(RPM, OVERSIGHT, SYSTEM_ADMIN))):
    out = []
    for event, meta in EVENTS.items():
        for lang in LANGUAGES:
            versions = db.query(SMSTemplate).filter(SMSTemplate.event_name == event, SMSTemplate.language == lang).order_by(SMSTemplate.version.desc()).all()
            active = next((v for v in versions if v.is_active), None)
            out.append({
                "event_name": event,
                "language": lang,
                "recipient": meta["recipient"],
                "variables": meta["variables"],
                "protected": event in PROTECTED_EVENTS,
                "active_text": None if event in PROTECTED_EVENTS else (active.template_text if active else meta[lang]),
                "active_version": active.version if active else None,
                "versions": [] if event in PROTECTED_EVENTS else [{"version": v.version, "text": v.template_text, "created_at": v.created_at, "is_active": v.is_active} for v in versions],
            })
    return out


class TemplateIn(BaseModel):
    event_name: str
    language: str = Field(pattern="^(en|sw)$")
    template_text: str = Field(min_length=5)


@router.post("/sms-templates/preview")
def preview_template(body: TemplateIn, _: CurrentUser = Depends(require_roles(*TEMPLATE_EDITORS, SYSTEM_ADMIN))):
    notifications.validate_template(body.event_name, body.template_text)
    sample = {"provider": "Asha Juma Mwakyusa", "period": "August 2026", "comment": "Please add evidence for 3 Aug", "hours": 48, "reference": "MP260901ABC", "minutes": 10}
    text = notifications.render(body.template_text, sample)
    return {"preview": text, "characters": len(text), "segments": (len(text) - 1) // 160 + 1}


@router.post("/sms-templates", status_code=201)
def publish_template(body: TemplateIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(*TEMPLATE_EDITORS))):
    if body.event_name in PROTECTED_EVENTS:
        raise HTTPException(status_code=403, detail="The OTP message is protected and cannot be edited here")
    notifications.validate_template(body.event_name, body.template_text)
    query = db.query(SMSTemplate).filter(SMSTemplate.event_name == body.event_name, SMSTemplate.language == body.language)
    latest = query.order_by(SMSTemplate.version.desc()).with_for_update().first()
    query.update({SMSTemplate.is_active: False})
    row = SMSTemplate(event_name=body.event_name, language=body.language, version=(latest.version + 1) if latest else 1,
                      template_text=body.template_text, is_active=True, created_by=current.id)
    db.add(row)
    system_audit.record(db, current, "sms_template", f"{body.event_name}:{body.language}", "publish",
                        before={"text": latest.template_text if latest else None}, after={"text": body.template_text, "version": row.version})
    _commit(db)
    return to_dict(row)


@router.get("/sms-outbox")
def sms_outbox(status: Optional[str] = None, limit: int = 200, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SYSTEM_ADMIN, OVERSIGHT))):
    query = db.query(SMSOutbox)
    if status:
        query = query.filter(SMSOutbox.status == status)
    rows = query.order_by(SMSOutbox.id.desc()).limit(min(limit, 1000)).all()
    full = SYSTEM_ADMIN in current.roles
    return [{**to_dict(r), "destination_phone": r.destination_phone if full else mask_phone(r.destination_phone)} for r in rows]


@router.get("/audit-events")
def audit_events(entity_type: Optional[str] = None, limit: int = 200, db: Session = Depends(get_db), _: CurrentUser = Depends(require_roles(*AUDIT_ADMIN_ROLES))):
    query = db.query(AuditEvent, User.full_name).outerjoin(User, User.id == AuditEvent.actor_id)
    if entity_type:
        query = query.filter(AuditEvent.entity_type == entity_type)
    return [{**to_dict(a), "actor_name": name} for a, name in query.order_by(AuditEvent.id.desc()).limit(min(limit, 1000))]
