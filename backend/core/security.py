from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..models import Role, Staff, User, UserRole, UserScope
from . import config

ALGORITHM = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expires}, config.SECRET_KEY, algorithm=ALGORITHM)


def get_user_roles(db: Session, user_id: int) -> set[str]:
    rows = db.query(Role.name).join(UserRole, UserRole.role_id == Role.id).filter(UserRole.user_id == user_id).all()
    return {r[0] for r in rows}


@dataclass
class CurrentUser:
    user: User
    roles: set[str]
    staff: Optional[Staff]
    scopes: list[UserScope] = field(default_factory=list)

    @property
    def id(self) -> int:
        return self.user.id

    @property
    def staff_id(self) -> int:
        return self.staff.id if self.staff else -1

    def has_any(self, *roles: str) -> bool:
        return bool(self.roles.intersection(roles))

    def scope_values(self, attr: str) -> set[int]:
        return {getattr(s, attr) for s in self.scopes if getattr(s, attr) is not None}


def load_current_user(db: Session, user: User) -> CurrentUser:
    return CurrentUser(
        user=user,
        roles=get_user_roles(db, user.id),
        staff=db.query(Staff).filter(Staff.user_id == user.id).first(),
        scopes=db.query(UserScope).filter(UserScope.user_id == user.id).all(),
    )


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> CurrentUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise unauthorized
    return load_current_user(db, user)


def require_roles(*roles: str):
    def dependency(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not current.has_any(*roles):
            raise HTTPException(status_code=403, detail=f"Requires one of roles: {', '.join(roles)}")
        return current

    return dependency
