from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...core.security import CurrentUser, create_access_token, get_current_user, hash_password, verify_password
from ...core.serialize import to_dict
from ...core.settings import get_setting
from ...db.session import get_db
from ...models import Cadre, Organization, User, utcnow
from ...services.forms import cadre_out

router = APIRouter()


@router.post("/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not user.is_active or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    user.last_login_at = utcnow()
    db.commit()
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@router.get("/me")
def me(current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    orgs = current.scope_values("organization_id")
    return {
        **to_dict(current.user, exclude=("hashed_password",)),
        "roles": sorted(current.roles),
        "staff": {**to_dict(current.staff, exclude=("payment_account",)), "legal_name": current.staff.legal_name} if current.staff else None,
        "cadre": cadre_out(db, db.get(Cadre, current.staff.cadre_id)) if current.staff else None,
        "organizations": [{"id": o.id, "name": o.name, "type": o.type} for o in db.query(Organization).filter(Organization.id.in_(orgs))],
        "scopes": [to_dict(s) for s in current.scopes],
        "client_settings": {
            "gps_capture_events": get_setting(db, "gps_capture_events"),
            "otp_length": get_setting(db, "otp_length"),
        },
    }


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


@router.post("/change-password", status_code=204)
def change_password(body: PasswordChange, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, current.user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current.user.hashed_password = hash_password(body.new_password)
    db.commit()


class LanguageIn(BaseModel):
    preferred_language: str = Field(pattern="^(en|sw)$")


@router.put("/me/language")
def set_language(body: LanguageIn, current: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    current.user.preferred_language = body.preferred_language
    db.commit()
    return {"preferred_language": body.preferred_language}
