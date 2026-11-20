from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
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
from ...models import Cadre, LoginFailure, Organization, User, utcnow
from ...services.forms import cadre_out

router = APIRouter()
GENERIC_FAILURE = "Incorrect username or password"


def _record(db: Session, action: str, username: str, user: User | None, **after) -> None:
    system_audit.record(db, None, "auth", user.id if user else None, action, after={"username": username[:100], **after})


# Account-wide lock only after many failures from all devices together: one device's guesses never lock others out.
ACCOUNT_LOCK_FACTOR = 10


def _client(request: Request) -> str:
    return (request.client.host if request.client else "")[:64] or "unknown"


@router.post("/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Password sign-in. Every attempt is audited.

    Wrong passwords are counted per username and device: after login_max_failures from one device, that device waits
    login_lockout_minutes for that username, while the real user elsewhere can still sign in. Only many failures from all
    devices together lock the account itself. Replies never reveal whether a username exists."""
    now = utcnow()
    client = _client(request)
    username = form.username[:100]
    window = now - timedelta(minutes=get_setting(db, "login_lockout_minutes"))
    max_failures = get_setting(db, "login_max_failures")
    from_here = db.query(LoginFailure).filter(LoginFailure.username == username, LoginFailure.client == client,
                                              LoginFailure.failed_at > window).count()
    if from_here >= max_failures:  # the same reply for real and unknown usernames; the audit names the account
        _record(db, "login_blocked", username, db.query(User).filter(User.username == username).first(), client=client)
        db.commit()
        raise HTTPException(status_code=429, detail="Too many failed sign-in attempts from this device. Wait a few minutes and try again, or ask an administrator.")

    user = db.query(User).filter(User.username == username).with_for_update().first()
    if user is None:
        verify_password(form.password, DUMMY_HASH)  # same work as a real check: don't reveal which usernames exist
        db.add(LoginFailure(username=username, client=client, failed_at=now))
        _record(db, "login_failed", username, None, reason="unknown_user", client=client)
        db.commit()
        raise HTTPException(status_code=400, detail=GENERIC_FAILURE)

    password_ok = verify_password(form.password, user.hashed_password)
    if user.locked_until and user.locked_until > now:
        _record(db, "login_blocked", username, user, client=client)
        db.commit()
        if not password_ok:
            raise HTTPException(status_code=400, detail=GENERIC_FAILURE)
        minutes = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)  # only the real password learns this
        raise HTTPException(status_code=429, detail=f"This account is locked for {minutes} minute(s) after many failed sign-ins. Ask an administrator to unlock it.")

    if not password_ok or not user.is_active:
        user.failed_login_count += 1
        db.add(LoginFailure(username=username, client=client, failed_at=now))
        db.flush()
        everywhere = db.query(LoginFailure).filter(LoginFailure.username == username, LoginFailure.failed_at > window).count()
        locked = everywhere >= max_failures * ACCOUNT_LOCK_FACTOR or from_here + 1 >= max_failures
        if everywhere >= max_failures * ACCOUNT_LOCK_FACTOR:
            user.locked_until = now + timedelta(minutes=get_setting(db, "login_lockout_minutes"))
            user.failed_login_count = 0
        _record(db, "login_failed", username, user, reason="inactive" if not user.is_active else "bad_password", locked=locked, client=client)
        db.commit()
        raise HTTPException(status_code=400, detail=GENERIC_FAILURE)

    user.failed_login_count, user.locked_until, user.last_login_at = 0, None, now
    db.query(LoginFailure).filter(LoginFailure.username == username, LoginFailure.client == client).delete()
    _record(db, "login_success", username, user, client=client)
    db.commit()
    return {"access_token": create_access_token(user), "token_type": "bearer", "must_change_password": user.must_change_password}


@router.get("/me")
def me(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    orgs = current.scope_values("organization_id")
    return {
        **to_dict(current.user, exclude=("hashed_password", "failed_login_count", "locked_until", "session_version")),
        "roles": sorted(current.roles),
        "staff": {**to_dict(current.staff, exclude=("payment_account",)), "legal_name": current.staff.legal_name} if current.staff else None,
        "cadre": cadre_out(db, db.get(Cadre, current.staff.cadre_id)) if current.staff else None,
        "organizations": [{"id": o.id, "name": o.name, "type": o.type} for o in db.query(Organization).filter(Organization.id.in_(orgs))],
        "scopes": [to_dict(s) for s in current.scopes],
        "client_settings": {
            "gps_capture_events": get_setting(db, "gps_capture_events"),
            "otp_length": get_setting(db, "otp_length"),
            "provider_otp_required": get_setting(db, "provider_otp_required"),
            "rm_approval_required": get_setting(db, "rm_approval_required"),
            "payroll_time_only": get_setting(db, "payroll_time_only"),
            "gps_required_on_submit": get_setting(db, "gps_required_on_submit"),
        },
    }


COMMON_PASSWORDS = {"password", "password1", "password123", "passw0rd", "12345678", "123456789", "1234567890", "qwerty123",
                    "11111111", "00000000", "abcd1234", "iloveyou", "welcome1", "welcome123", "admin123", "admin12345",
                    "letmein1", "tanzania", "tanzania1", "karibu123", "hrhpay123", "changeme", "changeme1"}


def weak_password(password: str, username: str) -> str | None:
    """Why a new password is too easy to guess, or None."""
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or username.lower() in lowered:
        return "Choose a less guessable password: not a common one and not containing your username."
    if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
        return "Use both letters and numbers in your password."
    if len(set(password)) < 4:
        return "Use more different characters in your password."
    return None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


@router.post("/change-password")
def change_password(body: PasswordChange, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Changes the password, ends every other session and returns a fresh token for this one."""
    user = db.query(User).filter(User.id == current.id).with_for_update().one()
    if not verify_password(body.current_password, user.hashed_password):
        # Wrong guesses count towards the sign-in lockout; on lockout this session also ends.
        user.failed_login_count += 1
        locked = user.failed_login_count >= get_setting(db, "login_max_failures")
        if locked:
            user.locked_until = utcnow() + timedelta(minutes=get_setting(db, "login_lockout_minutes"))
            user.failed_login_count = 0
            user.session_version += 1
        system_audit.record(db, current, "auth", user.id, "password_change_failed", after={"locked": locked})
        db.commit()
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=422, detail="Choose a password different from the current one")
    problem = weak_password(body.new_password, user.username)
    if problem:
        raise HTTPException(status_code=422, detail=problem)
    user.hashed_password = hash_password(body.new_password)
    user.must_change_password = False
    user.failed_login_count = 0
    user.password_changed_at = utcnow()
    system_audit.record(db, current, "auth", user.id, "password_changed")
    db.commit()
    return {"access_token": create_access_token(user), "token_type": "bearer"}


@router.post("/logout", status_code=204)
def logout(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Ends this user's sessions on the server, so a token left on a shared device stops working."""
    current.user.session_version += 1
    system_audit.record(db, current, "auth", current.id, "logout")
    db.commit()


class LanguageIn(BaseModel):
    preferred_language: str = Field(pattern="^(en|sw)$")


@router.put("/me/language")
def set_language(body: LanguageIn, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    current.user.preferred_language = body.preferred_language
    db.commit()
    return {"preferred_language": body.preferred_language}
