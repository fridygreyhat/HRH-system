"""Missing-only setup transfer; natural references, explicit review, no financial data."""
import hashlib
import json
import secrets
from datetime import date, datetime, timedelta, timezone

import jwt
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from ..core import audit, config
from ..core.security import hash_password
from ..models import (
    ActivityRate, Cadre, District, Facility, FundingSource, Organization, PayPeriod,
    Region, Role, Section, Staff, StaffAssignment, User, UserReviewCadre, UserRole,
    UserScope, Ward,
)
from .setup_transfer_schema import DATA_TYPES, TRANSFER_ROLES, TransferDocument

PRIORITY = {"organization": 0, "funding_source": 1, "facility": 2, "pay_period": 3,
            "user_setup": 4, "service_rate": 5}
WARNINGS = [
    "Setup only: no passwords, bank details, work logs, approvals, reports, payments or proof files.",
    "New accounts are inactive. Activate and reset their passwords in Users before sign-in.",
    "Existing roles, placements, rates and records are never removed or overwritten.",
    "Missing organizations and facilities must be selected with dependent user setup.",
    "CSO payment authority is not transferred. Configure it separately after review.",
]


def digest(value):
    return hashlib.sha256(json.dumps(jsonable_encoder(value), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def one(db, model, **values):
    rows = db.query(model).filter_by(**values).limit(2).all()
    if len(rows) != 1:
        raise ValueError(f"Missing or ambiguous {model.__name__}: " + ", ".join(str(v) for v in values.values()))
    return rows[0]


def region(db, name):
    return one(db, Region, name=name).id if name else None


def organization(db, name):
    return one(db, Organization, name=name).id if name else None


def facility_ref(db, row):
    ward = db.get(Ward, row.ward_id)
    district = db.get(District, ward.district_id)
    return {"name": row.name, "ward": ward.name, "district": district.name,
            "region": db.get(Region, district.region_id).name}


def ward_id(db, ref):
    district = one(db, District, region_id=region(db, ref["region"]), name=ref["district"])
    return one(db, Ward, district_id=district.id, name=ref["ward"]).id


def facility(db, ref):
    return one(db, Facility, ward_id=ward_id(db, ref), name=ref["name"]).id if ref else None


def name(db, model, key):
    return db.get(model, key).name if key else None


def assignment_data(db, row):
    if row.community_area_id:
        raise ValueError("Community placements require manual transfer")
    return {
        "region": name(db, Region, row.region_id), "district": name(db, District, row.district_id),
        "ward": name(db, Ward, row.ward_id),
        "facility": facility_ref(db, db.get(Facility, row.facility_id)) if row.facility_id else None,
        "organization": name(db, Organization, row.organization_id), "section": row.section,
        "start_date": row.start_date, "end_date": row.end_date, "is_primary": row.is_primary,
    }


def user_data(db, row):
    roles = sorted(r[0] for r in db.query(Role.name).join(UserRole, UserRole.role_id == Role.id).filter(UserRole.user_id == row.id))
    if not set(roles) <= TRANSFER_ROLES:
        raise ValueError("Administrator accounts are excluded")
    scopes = []
    for s in db.query(UserScope).filter_by(user_id=row.id).order_by(UserScope.id):
        if s.cluster_id or s.community_area_id:
            raise ValueError("Cluster/community scope requires manual transfer")
        scopes.append({
            "region": name(db, Region, s.region_id),
            "organization": name(db, Organization, s.organization_id),
            "facility": facility_ref(db, db.get(Facility, s.facility_id)) if s.facility_id else None,
        })
    staff = db.query(Staff).filter_by(user_id=row.id).one_or_none()
    staff_data = None
    if staff:
        staff_data = {key: getattr(staff, key) for key in (
            "first_name", "middle_name", "last_name", "occupation", "occupation_other",
            "employment_start_date", "employment_end_date")}
        staff_data.update(cadre=db.get(Cadre, staff.cadre_id).code,
                          assignments=[assignment_data(db, a) for a in db.query(StaffAssignment).filter_by(staff_id=staff.id).order_by(StaffAssignment.start_date)])
    return dict(username=row.username, full_name=row.full_name, phone=row.phone, roles=roles,
                scopes=scopes, staff=staff_data,
                review_cadres=sorted(r[0] for r in db.query(Cadre.code).join(UserReviewCadre, UserReviewCadre.cadre_id == Cadre.id).filter(UserReviewCadre.user_id == row.id)))


def rate_data(db, row):
    result = {key: getattr(row, key) for key in (
        "key", "source_key", "label_en", "label_sw", "item_type", "form_mode", "field_definitions",
        "hours_input", "rate_value", "currency", "unit_type", "billable_field", "effective_start_date")}
    result.update(cadre=db.get(Cadre, row.cadre_id).code, region=name(db, Region, row.region_id))
    return result


def export_document(db):
    records, warnings = [], []

    def add(kind, label, data):
        normalized = DATA_TYPES[kind].model_validate(data).model_dump(mode="json")
        records.append(dict(id=f"{kind}:{digest(normalized)[:24]}", kind=kind, label=label, data=normalized))

    for row in db.query(Organization).filter_by(is_active=True).order_by(Organization.id):
        add("organization", row.name, dict(name=row.name, code=row.code, type=row.type))
    for row in db.query(FundingSource).order_by(FundingSource.id):
        add("funding_source", row.name, dict(name=row.name, code=row.code))
    for row in db.query(Facility).filter_by(is_active=True).order_by(Facility.id):
        add("facility", row.name, {**facility_ref(db, row), "facility_type": row.facility_type})
    for row in db.query(PayPeriod).filter_by(status="OPEN").order_by(PayPeriod.id):
        add("pay_period", row.period_label or str(row.start_date), dict(
            region=name(db, Region, row.region_id), start_date=row.start_date,
            end_date=row.end_date, period_label=row.period_label, status=row.status))
    for row in db.query(User).filter_by(is_active=True).order_by(User.id):
        try:
            add("user_setup", row.username, user_data(db, row))
        except ValueError as exc:
            warnings.append(f"{row.username}: {str(exc).splitlines()[0][:160]}")
    for row in db.query(ActivityRate).filter_by(is_active=True, item_type="SERVICES", unit_type="PER_DAY").order_by(ActivityRate.id):
        add("service_rate", row.label_en, rate_data(db, row))
    return TransferDocument(version=1, records=records, warnings=warnings)


def scope_values(db, s):
    return {"region_id": region(db, s["region"]), "organization_id": organization(db, s["organization"]),
            "facility_id": facility(db, s["facility"]), "cluster_id": None, "community_area_id": None}


def placement_values(db, a):
    rid = region(db, a["region"])
    district = one(db, District, region_id=rid, name=a["district"]) if a["district"] else None
    if a["ward"] and not district:
        raise ValueError("Ward requires a district")
    wid = one(db, Ward, district_id=district.id, name=a["ward"]).id if a["ward"] else None
    if a["section"] and not db.get(Section, a["section"]):
        raise ValueError("Missing staff section")
    return dict(region_id=rid, district_id=district.id if district else None, ward_id=wid,
                facility_id=facility(db, a["facility"]), organization_id=organization(db, a["organization"]),
                section=a["section"], start_date=date.fromisoformat(a["start_date"]),
                end_date=date.fromisoformat(a["end_date"]) if a["end_date"] else None, is_primary=a["is_primary"])


def normalize(value):
    return jsonable_encoder(value)


def same_fields(row, values):
    return all(normalize(getattr(row, key)) == normalize(value) for key, value in values.items())


def user_changes(db, data):
    user = db.query(User).filter_by(username=data["username"]).one_or_none()
    phone_owner = db.query(User).filter_by(phone=data["phone"]).one_or_none()
    if phone_owner and (not user or phone_owner.id != user.id):
        raise ValueError("Phone number belongs to another account")
    if not user:
        return None, ["New inactive account; activation and password reset required"]
    actual = user_data(db, user)  # Administrator and unsupported-scope protection.
    if (actual["phone"], actual["full_name"]) != (data["phone"], data["full_name"]):
        raise ValueError("Existing account identity differs; edit manually")
    extra_roles = sorted(set(actual["roles"]) - set(data["roles"]))
    if extra_roles:
        raise ValueError("Target has additional roles requiring manual review: " + ", ".join(extra_roles))
    changes = []
    missing_roles = sorted(set(data["roles"]) - set(actual["roles"]))
    missing_cadres = sorted(set(data["review_cadres"]) - set(actual["review_cadres"]))
    if missing_roles:
        changes.append("Add roles: " + ", ".join(missing_roles))
    if missing_cadres:
        changes.append("Add review cadres: " + ", ".join(missing_cadres))
    if any(s not in normalize(actual["scopes"]) for s in data["scopes"]):
        changes.append("Add geographic/organization access shown in the document")
    desired, existing = data["staff"], normalize(actual["staff"])
    if desired:
        if not existing:
            changes.append("Create linked staff record")
        else:
            if any(existing[k] != v for k, v in desired.items() if k != "assignments"):
                raise ValueError("Existing staff identity/employment setup differs; edit manually")
            for a in desired["assignments"]:
                if a in existing["assignments"]:
                    continue
                for b in existing["assignments"]:
                    if max(a["start_date"], b["start_date"]) <= min(a["end_date"] or "9999-12-31", b["end_date"] or "9999-12-31"):
                        raise ValueError("Staff placement overlaps an existing placement; edit manually")
                changes.append(f"Add placement {a['start_date']} to {a['end_date'] or 'ongoing'}")
    elif existing:
        raise ValueError("Target has a staff record not present in source")
    if not user.is_active and changes:
        raise ValueError("Account is inactive; activate manually before adding further setup")
    return user, changes


def existing_record(db, record):
    d, kind = record.data, record.kind
    if kind == "organization":
        row = db.query(Organization).filter_by(name=d["name"]).one_or_none()
        if not row and d["code"] and db.query(Organization).filter_by(code=d["code"]).first():
            raise ValueError("Organization code belongs to a different name")
        if row and (not row.is_active or not same_fields(row, d)):
            raise ValueError("Organization differs or is inactive")
        return row
    if kind == "funding_source":
        row = db.query(FundingSource).filter_by(code=d["code"]).one_or_none()
        if row and not same_fields(row, d):
            raise ValueError("Funding code has a different name")
        if not row and db.query(FundingSource).filter_by(name=d["name"]).first():
            raise ValueError("Funding name has a different code")
        return row
    if kind == "facility":
        row = db.query(Facility).filter_by(ward_id=ward_id(db, d), name=d["name"]).one_or_none()
        if row and (not row.is_active or row.facility_type != d["facility_type"]):
            raise ValueError("Facility type differs or facility is inactive")
        return row
    if kind == "pay_period":
        values = dict(start_date=date.fromisoformat(d["start_date"]), end_date=date.fromisoformat(d["end_date"]),
                      region_id=region(db, d["region"]))
        row = db.query(PayPeriod).filter_by(**values).one_or_none()
        if row and (row.status != d["status"] or row.period_label != d["period_label"]):
            raise ValueError("Existing period label/status differs; edit manually")
        overlap = db.query(PayPeriod).filter(
            PayPeriod.region_id == values["region_id"], PayPeriod.status == "OPEN",
            PayPeriod.start_date <= values["end_date"], PayPeriod.end_date >= values["start_date"]).first()
        if not row and overlap:
            raise ValueError("Another open period overlaps these dates")
        return row
    if kind == "service_rate":
        values = dict(cadre_id=one(db, Cadre, code=d["cadre"]).id, region_id=region(db, d["region"]))
        row = db.query(ActivityRate).filter_by(key=d["key"]).one_or_none()
        peers = db.query(ActivityRate).filter_by(**values, label_en=d["label_en"],
                                               effective_start_date=date.fromisoformat(d["effective_start_date"])).all()
        if not row and peers:
            row = peers[0]
        if row and (not row.is_active or normalize(rate_data(db, row)) != d):
            raise ValueError("An existing rate differs; rates and paid snapshots are never overwritten")
        return row
    raise ValueError("Unsupported setup record")


def check_dependencies(db, record, document):
    """Resolve references, or require an explicit matching missing parent in this document."""
    def org(n):
        if n and not db.query(Organization).filter_by(name=n, is_active=True).first():
            if not any(r.kind == "organization" and r.data["name"] == n for r in document.records):
                raise ValueError(f"Missing organization: {n}")

    def fac(ref):
        if ref:
            ward_id(db, ref)
            if not db.query(Facility).filter_by(name=ref["name"], ward_id=ward_id(db, ref), is_active=True).first():
                if not any(r.kind == "facility" and all(r.data[k] == ref[k] for k in ref) for r in document.records):
                    raise ValueError(f"Missing facility: {ref['name']}")
    if record.kind == "user_setup":
        d = record.data
        for role in d["roles"]:
            one(db, Role, name=role)
        for code in d["review_cadres"] + ([d["staff"]["cadre"]] if d["staff"] else []):
            one(db, Cadre, code=code)
        for scope in d["scopes"]:
            region(db, scope["region"])
            org(scope["organization"])
            fac(scope["facility"])
        for a in d["staff"]["assignments"] if d["staff"] else []:
            region(db, a["region"])
            org(a["organization"])
            fac(a["facility"])


def plan(db, document):
    result = []
    for r in document.records:
        state, message = "MISSING", "Create missing setup"
        try:
            check_dependencies(db, r, document)
            if r.kind == "user_setup":
                _, changes = user_changes(db, r.data)
                state, message = ("MISSING", "; ".join(changes)) if changes else ("EXISTS", "Setup already present")
            elif existing_record(db, r):
                state, message = "EXISTS", "Setup already present"
        except ValueError as exc:
            state, message = "CONFLICT", str(exc)
        result.append(dict(id=r.id, kind=r.kind, label=r.label, state=state, message=message))
    return result


def fingerprint(db):
    """Include reviewed target configuration only; never credentials or financial records."""
    state = []
    for model in (Organization, FundingSource, Facility, Region, District, Ward, Cadre, Section,
                  User, UserRole, UserScope, UserReviewCadre, Staff, StaffAssignment, PayPeriod, ActivityRate):
        excluded = {"hashed_password", "email", "bank_name", "bank_account_number", "bank_branch",
                    "mobile_money_number", "payment_account", "payment_provider", "payment_method",
                    "verified_phone", "last_login_at", "failed_login_count", "locked_until", "password_changed_at",
                    "created_at", "updated_at", "assigned_at"}
        columns = [c for c in model.__table__.columns if c.name not in excluded]
        rows = [normalize(dict(zip([c.name for c in columns], row))) for row in db.query(*columns).all()]
        state.append((model.__tablename__, sorted(rows, key=lambda v: json.dumps(v, sort_keys=True))))
    return digest(state)


def review(db, current, document):
    token = jwt.encode(dict(purpose="setup-transfer", actor=current.id, document=digest(document.model_dump(mode="json")),
                            target=fingerprint(db), exp=datetime.now(timezone.utc) + timedelta(minutes=15)),
                       config.SECRET_KEY, algorithm="HS256")
    return dict(review_token=token, items=plan(db, document), warnings=WARNINGS + document.warnings)


def create_user_setup(db, current, data):
    user, _ = user_changes(db, data)
    if not user:
        user = User(username=data["username"], full_name=data["full_name"], phone=data["phone"],
                    hashed_password=hash_password(secrets.token_urlsafe(48)), is_active=False,
                    must_change_password=True)
        db.add(user)
        db.flush()
    for role in data["roles"]:
        rid = one(db, Role, name=role).id
        if not db.get(UserRole, (user.id, rid)):
            db.add(UserRole(user_id=user.id, role_id=rid, assigned_by=current.id))
    for code in data["review_cadres"]:
        cid = one(db, Cadre, code=code).id
        if not db.get(UserReviewCadre, (user.id, cid)):
            db.add(UserReviewCadre(user_id=user.id, cadre_id=cid, assigned_by=current.id))
    for scope in data["scopes"]:
        values = scope_values(db, scope)
        if not db.query(UserScope).filter_by(user_id=user.id, **values).first():
            db.add(UserScope(user_id=user.id, **values, created_by=current.id))
    if data["staff"]:
        d = data["staff"]
        staff = db.query(Staff).filter_by(user_id=user.id).one_or_none()
        if not staff:
            staff = Staff(user_id=user.id, cadre_id=one(db, Cadre, code=d["cadre"]).id,
                          verified_phone=data["phone"], status="ACTIVE", created_by=current.id,
                          **{k: (date.fromisoformat(v) if v and k.endswith("_date") else v)
                             for k, v in d.items() if k not in {"cadre", "assignments"}})
            db.add(staff)
            db.flush()
        for a in d["assignments"]:
            values = placement_values(db, a)
            if not db.query(StaffAssignment).filter_by(staff_id=staff.id, **values).first():
                db.add(StaffAssignment(staff_id=staff.id, **values, created_by=current.id))


def create_record(db, current, record):
    d, kind = record.data, record.kind
    if kind == "user_setup":
        create_user_setup(db, current, d)
    elif kind == "organization":
        db.add(Organization(**d, is_active=True))
    elif kind == "funding_source":
        db.add(FundingSource(**d))
    elif kind == "facility":
        db.add(Facility(name=d["name"], ward_id=ward_id(db, d), facility_type=d["facility_type"], is_active=True))
    elif kind == "pay_period":
        db.add(PayPeriod(region_id=region(db, d["region"]), start_date=date.fromisoformat(d["start_date"]),
                         end_date=date.fromisoformat(d["end_date"]), period_label=d["period_label"], status=d["status"]))
    elif kind == "service_rate":
        values = {k: v for k, v in d.items() if k not in {"region", "cadre"}}
        values["effective_start_date"] = date.fromisoformat(values["effective_start_date"])
        db.add(ActivityRate(**values, cadre_id=one(db, Cadre, code=d["cadre"]).id,
                            region_id=region(db, d["region"]), created_by=current.id, is_active=True))
    db.flush()


def apply(db, current, document, selected_ids, token, reason):
    try:
        claims = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(409, "Setup review expired or is invalid. Review the document again.")
    # Serialize transfers and lock the reviewed configuration against other admin writes.
    try:
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SELECT pg_advisory_xact_lock(746839210)"))
        db.execute(text("LOCK TABLE organizations, funding_sources, facilities, regions, districts, wards, cadres, sections, "
                        "users, user_roles, user_scopes, user_review_cadres, staff, staff_assignments, pay_periods, activity_rates "
                        "IN SHARE ROW EXCLUSIVE MODE"))
    except DBAPIError as exc:
        db.rollback()
        raise HTTPException(409, "Setup is busy. Review again and retry when other changes have finished.") from exc
    if (claims.get("purpose") != "setup-transfer" or claims.get("actor") != current.id
            or claims.get("document") != digest(document.model_dump(mode="json"))
            or claims.get("target") != fingerprint(db)):
        raise HTTPException(409, "The document or target setup changed. Review again before applying.")
    items = plan(db, document)
    states = {r["id"]: r["state"] for r in items}
    if len(set(selected_ids)) != len(selected_ids) or any(states.get(i) != "MISSING" for i in selected_ids):
        raise HTTPException(409, "Select only missing setup from the current review.")
    selected = sorted((r for r in document.records if r.id in selected_ids), key=lambda r: PRIORITY[r.kind])
    try:
        for record in selected:
            # Revalidate dependencies after parents have actually been selected and created.
            if record.kind == "user_setup":
                for scope in record.data["scopes"]:
                    scope_values(db, scope)
                for a in record.data["staff"]["assignments"] if record.data["staff"] else []:
                    placement_values(db, a)
            create_record(db, current, record)
            audit.record(db, current, "setup_transfer", record.id, "apply_missing_setup",
                         after={"kind": record.kind, "label": record.label, "data": record.data}, reason=reason)
        db.commit()
    except (ValueError, IntegrityError) as exc:
        db.rollback()
        raise HTTPException(409, "Setup was not applied. Select required dependencies and resolve conflicts, then review again.") from exc
    except Exception:
        db.rollback()
        raise
    return dict(applied=len(selected), skipped=len(document.records) - len(selected), items=plan(db, document))
