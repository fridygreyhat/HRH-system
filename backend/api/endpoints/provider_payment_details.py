import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.roles import PROVIDER, CSO_FINANCE, FHI360_FINANCE
from ...core.security import CurrentUser, require_roles
from ...db.session import get_db
from ...models import Staff, utcnow
from ...services import notifications, payment_detail_codes, provider_payment_details as pd
from ...services.scope import staff_visibility

def private_response(response: Response):
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(dependencies=[Depends(private_response)])


class DetailsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bank_name: Optional[str] = Field(default=None, max_length=100)
    bank_account_number: Optional[str] = Field(default=None, max_length=34)
    bank_branch: Optional[str] = Field(default=None, max_length=100)
    mobile_money_number: Optional[str] = Field(default=None, max_length=20)

    @field_validator("*", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() or None if isinstance(value, str) else value

    @field_validator("bank_account_number")
    @classmethod
    def account(cls, value):
        if value is not None and not re.fullmatch(r"[0-9]{6,34}", value):
            raise ValueError("Bank account number must contain 6–34 digits")
        return value

    @field_validator("mobile_money_number")
    @classmethod
    def mobile(cls, value):
        if value is None:
            return None
        normalized = re.sub(r"[\s()-]", "", value)
        if normalized.startswith("0"):
            normalized = "+255" + normalized[1:]
        elif normalized.startswith("255"):
            normalized = "+" + normalized
        if not re.fullmatch(r"\+255[67][0-9]{8}", normalized):
            raise ValueError("Enter a Tanzanian mobile-money number, such as +2557XXXXXXXX")
        return normalized


class ConfirmedDetailsIn(DetailsIn):
    code: Optional[str] = Field(default=None, pattern=r"^[0-9]{6}$")


def _locked_provider(db: Session, current: CurrentUser) -> Staff:
    staff = db.query(Staff).filter_by(id=current.staff_id).populate_existing().with_for_update().first()
    if staff is None:
        raise HTTPException(404, "No provider profile is linked to this account")
    if staff.status != "ACTIVE":
        raise HTTPException(403, "This staff member has left, so payment details can no longer be changed here.")
    return staff


def _new_details(staff: Staff, changes: dict) -> dict:
    merged = {**pd.details(staff), **changes}
    if any(key in changes for key in pd.FIELDS[:3]) and any(merged[key] for key in pd.FIELDS[:3]) and not all(merged[key] for key in pd.FIELDS[:3]):
        raise HTTPException(422, "For bank payments, provide the bank name, account number and branch together")
    return merged


@router.get("/me")
def mine(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(PROVIDER))):
    if current.staff is None:
        raise HTTPException(404, "No provider profile is linked to this account")
    return {"staff_id": current.staff.id, **pd.details(current.staff)}


@router.post("/me/code")
def send_code(body: DetailsIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(PROVIDER))):
    """Step one of a change: text a code to the registered phone. Nothing is saved until the code comes back."""
    staff = _locked_provider(db, current)
    merged = _new_details(staff, body.model_dump(exclude_unset=True))
    if merged == pd.details(staff):
        return {"changed": False}
    return {"changed": True, **payment_detail_codes.send(db, current, staff, merged)}


@router.put("/me")
def update_mine(body: ConfirmedDetailsIn, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(PROVIDER))):
    staff = _locked_provider(db, current)
    changes = body.model_dump(exclude_unset=True, exclude={"code"})
    merged = _new_details(staff, changes)
    if merged == pd.details(staff):
        return {"staff_id": staff.id, **pd.details(staff)}
    payment_detail_codes.verify(db, current, staff, merged, body.code)
    for key, value in merged.items():
        setattr(staff, key, value)
    staff.payment_details_updated_at = utcnow()
    # Audit which fields changed, never bank-account values or mobile numbers.
    system_audit.record(db, current, "staff", staff.id, "update_payment_details",
                        after={"changed_fields": sorted(changes)})
    # Sent to the registered phone, which only a second admin can change, so a changed account cannot go unnoticed.
    notifications.enqueue(db, "PAYMENT_DETAILS_CHANGED", None, staff.verified_phone)
    db.commit()
    return {"staff_id": staff.id, **pd.details(staff)}


@router.get("/{staff_id}")
def finance_details(staff_id: int, db: Session = Depends(get_db),
                    current: CurrentUser = Depends(require_roles(CSO_FINANCE, FHI360_FINANCE))):
    staff = db.query(Staff).filter(Staff.id == staff_id, staff_visibility(current)).first()
    if staff is None:
        raise HTTPException(404, "Provider not found")
    result = pd.visible_details(db, current, staff)
    if len(result) == 1:
        raise HTTPException(404, "No assigned payable work permits access to these details")
    system_audit.record(db, current, "staff", staff.id, "view_payment_details",
                        after={"fields": sorted(set(result) - {"staff_id"})})
    db.commit()
    return result


@router.put("/update-details/{staff_id}")
def update_self_alias(staff_id: int, body: ConfirmedDetailsIn, db: Session = Depends(get_db),
                      current: CurrentUser = Depends(require_roles(PROVIDER))):
    """Compatibility path from the supplied requirements; never an edit-any-provider API."""
    if staff_id != current.staff_id:
        raise HTTPException(404, "Provider profile not found")
    return update_mine(body, db, current)
