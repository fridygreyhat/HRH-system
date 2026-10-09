from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.security import (
    DUMMY_HASH,
    CurrentUser,
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from ...core.serialize import to_dict
from ...core.settings import get_setting
from ...db.session import get_db
from ...models import Cadre, Organization, User, utcnow
from ...services.forms import cadre_out

router = APIRouter()
GENERIC_FAILURE = "Incorrect username or password"


def _record(db: Session, action: str, username: str, user: User | None, **after) -> None:
    system_audit.record(db, None, "auth", user.id if user else None, action, after={"username": username[:100], **after})


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Password sign-in with lockout after repeated failures. Every attempt is audited."""
    now = utcnow()
    user = db.query(User).filter(User.username == form.username).with_for_update().first()
    if user is None:
        verify_password(form.password, DUMMY_HASH)  # same work as a real check: don't reveal which usernames exist
        _record(db, "login_failed", form.username, None, reason="unknown_user")
        db.commit()
        raise HTTPException(status_code=400, detail=GENERIC_FAILURE)

    if user.locked_until and user.locked_until > now:
        minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        _record(db, "login_blocked", form.username, user)
        db.commit()
        raise HTTPException(status_code=429, detail=f"Too many failed sign-in attempts. Try again in {minutes} minute(s) or ask an administrator.")

    if not verify_password(form.password, user.hashed_password) or not user.is_active:
        user.failed_login_count += 1
        locked = user.failed_login_count >= get_setting(db, "login_max_failures")
        if locked:
            user.locked_until = now + timedelta(minutes=get_setting(db, "login_lockout_minutes"))
            user.failed_login_count = 0
        _record(db, "login_failed", form.username, user, reason="inactive" if not user.is_active else "bad_password", locked=locked)
        db.commit()
        raise HTTPException(status_code=400, detail=GENERIC_FAILURE)

    user.failed_login_count, user.locked_until, user.last_login_at = 0, None, now
    _record(db, "login_success", form.username, user)
    db.commit()
    return {"access_token": create_access_token(user), "token_type": "bearer", "must_change_password": user.must_change_password}


@router.get("/me")
def me(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    orgs = current.scope_values("organization_id")
    return {
        **to_dict(current.user, exclude=("hashed_password", "failed_login_count", "locked_until")),
        "roles": sorted(current.roles),
        "staff": {**to_dict(current.staff, exclude=("payment_account",)), "legal_name": current.staff.legal_name} if current.staff else None,
        "cadre": cadre_out(db, db.get(Cadre, current.staff.cadre_id)) if current.staff else None,
        "organizations": [{"id": o.id, "name": o.name, "type": o.type} for o in db.query(Organization).filter(Organization.id.in_(orgs))],
        "scopes": [to_dict(s) for s in current.scopes],
        "client_settings": {
            "gps_capture_events": get_setting(db, "gps_capture_events"),
            "otp_length": get_setting(db, "otp_length"),
            "provider_otp_required": get_setting(db, "provider_otp_required"),
            "gps_required_on_submit": get_setting(db, "gps_required_on_submit"),
        },
    }


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


@router.post("/change-password")
def change_password(body: PasswordChange, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Changes the password, ends every other session and returns a fresh token for this one."""
    user = current.user
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=422, detail="Choose a password different from the current one")
    if body.new_password.lower() in {user.username.lower(), "password", "password123", "12345678"}:
        raise HTTPException(status_code=422, detail="Choose a less guessable password")
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = False
    user.password_changed_at = utcnow()
    system_audit.record(db, current, "auth", user.id, "password_changed")
    db.commit()
    return {"access_token": create_access_token(user), "token_type": "bearer"}


class LanguageIn(BaseModel):
    preferred_language: str = Field(pattern="^(en|sw)$")


@router.put("/me/language")
def set_language(body: LanguageIn, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    current.user.preferred_language = body.preferred_language
    db.commit()
    return {"preferred_language": body.preferred_language}
