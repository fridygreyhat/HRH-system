from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..models import CommunityArea, Cluster, Facility, Organization, Region, Role, Staff, User, UserReviewCadre, UserRole, UserScope
from . import config
from .roles import ALL_ROLES, PROVIDER, SUPER_ADMIN

ALGORITHM = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


# Endpoints a user with a temporary password may still call.
PASSWORD_CHANGE_ALLOWED_PATHS = {"/auth/me", "/auth/change-password", "/auth/logout"}
# Verified against when the username does not exist, so response time does not reveal valid usernames.
DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt()).decode()


def password_version(user: User) -> int:
    return int(user.password_changed_at.timestamp() * 1000) if user.password_changed_at else 0  # milliseconds: two changes in one second still differ


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    claims = {"sub": str(user.id), "iat": now, "exp": now + timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES),
              "pwv": password_version(user), "sv": user.session_version}
    return jwt.encode(claims, config.SECRET_KEY, algorithm=ALGORITHM)


def get_user_roles(db: Session, user_id: int) -> set[str]:
    rows = db.query(Role.name).join(UserRole, UserRole.role_id == Role.id).filter(UserRole.user_id == user_id).all()
    return {r[0] for r in rows}


@dataclass
class CurrentUser:
    user: User
    roles: set[str]
    staff: Optional[Staff]
    scopes: list[UserScope] = field(default_factory=list)
    # Technical officers: the cadres whose logs they review (their technical area)
    review_cadres: set[int] = field(default_factory=set)
    # Super administrators act in every role with no scope limit; `db` answers their scope lookups.
    unrestricted: bool = False
    db: Optional[Session] = field(default=None, repr=False)
    _all_ids: dict[str, set[int]] = field(default_factory=dict, repr=False)

    @property
    def id(self) -> int:
        return self.user.id

    @property
    def staff_id(self) -> int:
        return self.staff.id if self.staff else -1

    def has_any(self, *roles: str) -> bool:
        return bool(self.roles.intersection(roles))

    def scope_values(self, attr: str) -> set[int]:
        if self.unrestricted and self.db is not None and attr in SCOPE_MODELS:
            if attr not in self._all_ids:
                self._all_ids[attr] = {row[0] for row in self.db.query(SCOPE_MODELS[attr].id)}
            return self._all_ids[attr]
        return {getattr(s, attr) for s in self.scopes if getattr(s, attr) is not None}


SCOPE_MODELS = {"region_id": Region, "cluster_id": Cluster, "facility_id": Facility, "community_area_id": CommunityArea, "organization_id": Organization}


def load_current_user(db: Session, user: User) -> CurrentUser:
    roles = get_user_roles(db, user.id)
    unrestricted = SUPER_ADMIN in roles
    if unrestricted:
        roles |= set(ALL_ROLES) - {PROVIDER}  # PROVIDER needs a linked staff record, so it is only ever held directly
    return CurrentUser(
        user=user,
        roles=roles,
        staff=db.query(Staff).filter(Staff.user_id == user.id).first(),
        scopes=db.query(UserScope).filter(UserScope.user_id == user.id).all(),
        review_cadres={r[0] for r in db.query(UserReviewCadre.cadre_id).filter(UserReviewCadre.user_id == user.id)},
        unrestricted=unrestricted,
        db=db,
    )


def get_current_user(request: Request, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> CurrentUser:
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
    if not user or not user.is_active or payload.get("pwv", 0) != password_version(user) or payload.get("sv") != user.session_version:
        raise unauthorized  # deactivated, signed out, or the password changed since this token was issued
    if user.must_change_password and request.url.path not in PASSWORD_CHANGE_ALLOWED_PATHS:
        raise HTTPException(status_code=403, detail="You must change your temporary password before continuing")
    return load_current_user(db, user)


def require_roles(*roles: str):
    def dependency(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not current.has_any(*roles):
            raise HTTPException(status_code=403, detail=f"Requires one of roles: {', '.join(roles)}")
        return current

    return dependency
