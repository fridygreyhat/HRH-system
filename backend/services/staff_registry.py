"""One authoritative identity per person. Rotations end the current assignment and start a new one."""
import csv
import io
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core import audit as system_audit
from ..core.security import CurrentUser
from ..core.serialize import mask_payment_fields, to_dict
from ..core.settings import get_setting
from ..models import (
    Cadre,
    CommunityArea,
    Facility,
    Organization,
    Region,
    RosterImport,
    Section,
    Staff,
    StaffAssignment,
    StaffChangeRequest,
    Ward,
    District,
    utcnow,
)

# Changing these affects who pays, how much, or where; CSOs may only request them.
PAYMENT_CRITICAL_FIELDS = {"cadre_id", "salary_scale", "monthly_salary", "payment_method", "payment_provider", "payment_account", "verified_phone"}
PHONE_PATTERN = re.compile(r"^\+?\d{9,15}$")


def validate_changes(db: Session, staff: Staff, changes: dict) -> None:
    unknown = set(changes) - EDITABLE_FIELDS
    if unknown:
        hint = " (use the exit action to end employment)" if "status" in unknown else ""
        raise HTTPException(status_code=422, detail=f"Fields cannot be edited here: {sorted(unknown)}{hint}")
    if "cadre_id" in changes and not db.get(Cadre, changes["cadre_id"]):
        raise HTTPException(status_code=422, detail="Unknown cadre")
    if "verified_phone" in changes:
        phone = str(changes["verified_phone"] or "")
        if not PHONE_PATTERN.match(phone):
            raise HTTPException(status_code=422, detail="Phone must be 9–15 digits, optionally starting with +")
        if db.query(Staff).filter(Staff.verified_phone == phone, Staff.id != staff.id).first():
            raise HTTPException(status_code=409, detail="Another staff member already has this phone")
    for name in ("first_name", "last_name"):
        if name in changes and not str(changes[name] or "").strip():
            raise HTTPException(status_code=422, detail=f"{name} cannot be empty")
    if "monthly_salary" in changes and changes["monthly_salary"] is not None:
        try:
            salary = Decimal(str(changes["monthly_salary"]))
        except InvalidOperation:
            raise HTTPException(status_code=422, detail="monthly_salary must be a number")
        if not salary.is_finite() or salary < 0 or salary >= Decimal(10) ** 13:
            raise HTTPException(status_code=422, detail="monthly_salary must be zero or more")
    if changes.get("payment_method") not in (None, "MOBILE_WALLET", "BANK"):
        raise HTTPException(status_code=422, detail="payment_method must be MOBILE_WALLET or BANK")
    check_payment_method(db, changes.get("cadre_id", staff.cadre_id), changes.get("payment_method", staff.payment_method))


def check_payment_method(db: Session, cadre_id: Optional[int], method: Optional[str]) -> None:
    """Cadres listed in the bank_only_cadres setting (HCP by default) are paid into a bank account only."""
    cadre = db.get(Cadre, cadre_id) if cadre_id else None
    if cadre and method and method != "BANK" and cadre.code in get_setting(db, "bank_only_cadres"):
        raise HTTPException(status_code=422, detail=f"{cadre.name} staff must be paid into a bank account, not a mobile wallet")
EDITABLE_FIELDS = {"first_name", "middle_name", "last_name", "occupation", "occupation_other"} | PAYMENT_CRITICAL_FIELDS


def update_staff(db: Session, current: CurrentUser, staff: Staff, changes: dict, reason: Optional[str]) -> Staff:
    validate_changes(db, staff, changes)
    before = {k: getattr(staff, k) for k in changes}
    for key, value in changes.items():
        setattr(staff, key, value)
    system_audit.record(db, current, "staff", staff.id, "update", before=mask_payment_fields(before), after=mask_payment_fields(changes), reason=reason)
    return staff


def request_change(db: Session, current: CurrentUser, staff: Staff, changes: dict, reason: str) -> StaffChangeRequest:
    validate_changes(db, staff, changes)
    request = StaffChangeRequest(staff_id=staff.id, changes=jsonable_encoder(changes), reason=reason, requested_by=current.id)
    db.add(request)
    db.flush()
    system_audit.record(db, current, "staff_change_request", request.id, "create", after=mask_payment_fields(changes), reason=reason)
    return request


def rotate(db: Session, current: CurrentUser, staff: Staff, new: dict, effective: date, reason: str) -> StaffAssignment:
    """End the open assignment the day before `effective` and start a new one. History is preserved."""
    open_rows = db.query(StaffAssignment).filter(StaffAssignment.staff_id == staff.id, StaffAssignment.end_date.is_(None)).all()
    for row in open_rows:
        if row.start_date >= effective:
            raise HTTPException(status_code=422, detail=f"The current assignment starts on {row.start_date}; the rotation must be later")
        row.end_date = effective - timedelta(days=1)
        row.end_reason = reason
    assignment = StaffAssignment(staff_id=staff.id, start_date=effective, created_by=current.id, **new)
    db.add(assignment)
    db.flush()
    system_audit.record(db, current, "staff_assignment", assignment.id, "rotate", before=[to_dict(r) for r in open_rows], after=to_dict(assignment), reason=reason)
    return assignment


def exit_staff(db: Session, current: CurrentUser, staff: Staff, end_date: date, reason: str) -> None:
    staff.status, staff.employment_end_date = "EXITED", end_date
    for row in db.query(StaffAssignment).filter(StaffAssignment.staff_id == staff.id, StaffAssignment.end_date.is_(None)):
        row.end_date = max(end_date, row.start_date)
        row.end_reason = f"Exit: {reason}"
    system_audit.record(db, current, "staff", staff.id, "exit", after={"end_date": end_date}, reason=reason)


ROSTER_COLUMNS = ["first_name", "middle_name", "last_name", "phone", "cadre", "occupation", "salary_scale", "region", "district",
                  "ward", "facility", "community_area", "section", "organization", "start_date"]


def facility_for_name(db: Session, ward_id: int, name: str) -> Facility:
    """Facilities are typed by hand: reuse the ward's facility with the same name (any case), otherwise register it."""
    name = " ".join(name.split())
    facility = db.query(Facility).filter(Facility.ward_id == ward_id, func.lower(Facility.name) == name.lower()).first()
    if not facility:
        facility = Facility(ward_id=ward_id, name=name)
        db.add(facility)
        db.flush()
    return facility


def import_roster(db: Session, current: CurrentUser, filename: str, content: str, source: str, allowed_region_ids: Optional[set[int]]) -> RosterImport:
    """Create staff (or, for an existing phone number, record a rotation) from an approved roster CSV.

    Rows are validated individually; a bad row is reported and skipped. Matching by verified phone keeps one
    identity per person.
    """
    reader = csv.DictReader(io.StringIO(content.lstrip("﻿")))
    missing = {"first_name", "last_name", "phone", "cadre", "region", "start_date"} - set(reader.fieldnames or [])
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing required columns: {sorted(missing)}. Expected: {ROSTER_COLUMNS}")

    def lookup(model, name, **parent):
        if not (name and name.strip()):
            return None
        return db.query(model).filter(func.lower(model.name) == name.strip().lower(), *(getattr(model, k) == v for k, v in parent.items())).first()

    def lookup_any(model, name):
        return lookup(model, name)

    def optional_id(model, name, **parent):
        row = lookup(model, name, **parent)
        if name and name.strip() and not row:
            raise ValueError(f"Unknown {model.__tablename__[:-1]} '{name}'")
        return row.id if row else None

    result = RosterImport(filename=filename, enrollment_source=source, uploaded_by=current.id, errors=[], total_rows=0, created_count=0, updated_count=0, error_count=0)
    errors = []
    for line_no, row in enumerate(reader, start=2):
        result.total_rows += 1
        try:
            with db.begin_nested():
                cadre = db.query(Cadre).filter(Cadre.code == (row.get("cadre") or "").strip().upper()).first()
                region = lookup_any(Region, row.get("region"))
                if not cadre:
                    raise ValueError(f"Unknown cadre '{row.get('cadre')}'")
                if not region:
                    raise ValueError(f"Unknown region '{row.get('region')}'")
                if allowed_region_ids is not None and region.id not in allowed_region_ids:
                    raise ValueError(f"Region '{region.name}' is outside your administrative scope")
                # Ward names repeat across the country, so each level is looked up inside its parent.
                district_id = optional_id(District, row.get("district"), region_id=region.id)
                ward_id = optional_id(Ward, row.get("ward"), district_id=district_id) if district_id else None
                if (row.get("ward") or "").strip() and not district_id:
                    raise ValueError("Give the district together with the ward")
                facility_name = (row.get("facility") or "").strip()
                if facility_name and not ward_id:
                    raise ValueError("Give the district and ward together with the facility")
                facility = facility_for_name(db, ward_id, facility_name) if facility_name else None
                org = lookup_any(Organization, row.get("organization"))
                if row.get("organization") and not org:
                    raise ValueError(f"Unknown organization '{row.get('organization')}'")
                section = (row.get("section") or "").strip().upper() or None
                if section and not db.get(Section, section):
                    raise ValueError(f"Unknown section '{section}'")
                start = date.fromisoformat(row["start_date"].strip())
                phone = row["phone"].strip()
                assignment = {
                    "region_id": region.id,
                    "district_id": district_id,
                    "ward_id": ward_id,
                    "facility_id": facility.id if facility else None,
                    "community_area_id": optional_id(CommunityArea, row.get("community_area")) if row.get("community_area") else None,
                    "section": section,
                    "organization_id": org.id if org else None,
                }
                staff = db.query(Staff).filter(Staff.verified_phone == phone).first()
                if staff:
                    current_row = db.query(StaffAssignment).filter(StaffAssignment.staff_id == staff.id, StaffAssignment.end_date.is_(None)).first()
                    # A regional admin may only move people who currently work in their own region.
                    if allowed_region_ids is not None and (current_row is None or current_row.region_id not in allowed_region_ids):
                        raise ValueError("This phone belongs to a staff member outside your administrative region")
                    if current_row and all(getattr(current_row, k) == v for k, v in assignment.items()):
                        continue  # unchanged
                    rotate(db, current, staff, assignment, start, f"Roster import {filename} line {line_no}")
                    result.updated_count += 1
                else:
                    staff = Staff(
                        cadre_id=cadre.id,
                        first_name=row["first_name"].strip(),
                        middle_name=(row.get("middle_name") or "").strip() or None,
                        last_name=row["last_name"].strip(),
                        verified_phone=phone,
                        occupation=(row.get("occupation") or "").strip() or None,
                        salary_scale=(row.get("salary_scale") or "").strip() or None,
                        employment_start_date=start,
                        enrollment_source=source,
                        created_by=current.id,
                    )
                    db.add(staff)
                    db.flush()
                    db.add(StaffAssignment(staff_id=staff.id, start_date=start, created_by=current.id, **assignment))
                    result.created_count += 1
        except (ValueError, KeyError, AttributeError, HTTPException) as e:
            detail = e.detail if isinstance(e, HTTPException) else ("A required cell is empty" if isinstance(e, AttributeError) else str(e))
            errors.append({"line": line_no, "error": detail})
    result.error_count = len(errors)
    result.errors = errors
    db.add(result)
    db.flush()
    system_audit.record(db, current, "roster_import", result.id, "import", after={"file": filename, "created": result.created_count, "updated": result.updated_count, "errors": result.error_count})
    return result


def decide_change_request(db: Session, current: CurrentUser, request: StaffChangeRequest, approve: bool, comment: Optional[str]) -> None:
    if request.status != "PENDING":
        raise HTTPException(status_code=409, detail="This request was already decided")
    if request.requested_by == current.id:
        raise HTTPException(status_code=403, detail="You cannot decide your own change request")
    request.status = "APPROVED" if approve else "REJECTED"
    request.decided_by, request.decided_at, request.decision_comment = current.id, utcnow(), comment
    if approve:
        update_staff(db, current, db.get(Staff, request.staff_id), request.changes, f"Change request #{request.id}: {request.reason}")
    system_audit.record(db, current, "staff_change_request", request.id, request.status.lower(), reason=comment)
