from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, false, text

from .base import Base, created_at, utcnow


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=False)
    email = Column(String(255))
    phone = Column(String(20), unique=True, nullable=False)
    preferred_language = Column(String(5), default="sw", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_login_at = Column(DateTime(timezone=True))
    # Sign-in protection
    failed_login_count = Column(Integer, nullable=False, default=0, server_default=text("0"))
    locked_until = Column(DateTime(timezone=True))
    # Set when an administrator issues a temporary password; the user must choose their own before doing anything else.
    must_change_password = Column(Boolean, nullable=False, default=False, server_default=false())
    # Tokens carry this timestamp; changing or resetting the password invalidates every earlier session.
    password_changed_at = Column(DateTime(timezone=True))
    created_at = created_at()


class Role(Base):
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(255))


class UserRole(Base):
    __tablename__ = "user_roles"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    role_id = Column(Integer, ForeignKey("roles.id"), primary_key=True)
    assigned_by = Column(Integer, ForeignKey("users.id"))
    assigned_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class UserScope(Base):
    """Where a user's roles apply. Each non-null column grants access to that unit (region, cluster, facility, ...)."""

    __tablename__ = "user_scopes"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    region_id = Column(Integer, ForeignKey("regions.id"))
    cluster_id = Column(Integer, ForeignKey("clusters.id"))
    facility_id = Column(Integer, ForeignKey("facilities.id"))
    community_area_id = Column(Integer, ForeignKey("community_areas.id"))
    organization_id = Column(Integer, ForeignKey("organizations.id"))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = created_at()
