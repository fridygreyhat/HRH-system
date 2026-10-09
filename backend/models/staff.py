"""Staff registry: one identity per person, effective-dated assignments, cadre form templates."""
from sqlalchemy import Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, created_at, updated_at


class Cadre(Base):
    __tablename__ = "cadres"
    __table_args__ = (CheckConstraint("hours_mode IN ('DIRECT', 'START_END')", name="hours_mode"),)
    id = Column(Integer, primary_key=True)
    code = Column(String(30), unique=True, nullable=False)  # CHW, DATA_CLERK, HCP
    name = Column(String(100), nullable=False)
    form_title = Column(String(255))
    hours_mode = Column(String(20), nullable=False)  # CHW captures hours directly; others from start/end time
    uses_facility_geofence = Column(Boolean, default=True, nullable=False)
    requires_facility_endorsement = Column(Boolean, default=False, nullable=False)
    # FHI360 position that gives technical endorsement for this cadre's logs, e.g. "Regional Strategic Information Officer"
    technical_reviewer_title = Column(String(255))
    occupation_options = Column(JSONB, default=list, nullable=False)
    uses_section = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)


class CadreFormField(Base):
    """One row of a supplied paper work-log form (a daily measure)."""

    __tablename__ = "cadre_form_fields"
    __table_args__ = (
        UniqueConstraint("cadre_id", "key"),
        CheckConstraint("field_type IN ('INTEGER', 'BOOLEAN')", name="field_type"),
    )
    id = Column(Integer, primary_key=True)
    cadre_id = Column(Integer, ForeignKey("cadres.id"), nullable=False)
    key = Column(String(80), nullable=False)
    label_en = Column(String(255), nullable=False)
    label_sw = Column(String(255))
    field_type = Column(String(20), nullable=False, default="INTEGER")
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, default=True, nullable=False)


class Staff(Base):
    __tablename__ = "staff"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE', 'EXITED')", name="status"),
        CheckConstraint("enrollment_source IN ('ROSTER_IMPORT', 'ENGAGEMENT_LIST', 'MANUAL')", name="enrollment_source"),
    )
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    cadre_id = Column(Integer, ForeignKey("cadres.id"), nullable=False)
    first_name = Column(String(100), nullable=False)
    middle_name = Column(String(100))
    last_name = Column(String(100), nullable=False)
    verified_phone = Column(String(20), unique=True, nullable=False)
    occupation = Column(String(100))
    occupation_other = Column(String(100))
    salary_scale = Column(String(50))
    status = Column(String(20), default="ACTIVE", nullable=False)
    employment_start_date = Column(Date)
    employment_end_date = Column(Date)
    enrollment_source = Column(String(30), default="MANUAL", nullable=False)
    # Sensitive: restricted to finance roles and the staff member; access is audited.
    payment_method = Column(String(30))  # MOBILE_WALLET, BANK
    payment_provider = Column(String(100))
    payment_account = Column(String(100))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = created_at()
    updated_at = updated_at()

    @property
    def legal_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.middle_name, self.last_name) if p)


class StaffAssignment(Base):
    """Effective-dated placement. Rotations end one row and start another; history is never rewritten."""

    __tablename__ = "staff_assignments"
    __table_args__ = (CheckConstraint("end_date IS NULL OR end_date >= start_date", name="dates"),)
    id = Column(Integer, primary_key=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False, index=True)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False)
    district_id = Column(Integer, ForeignKey("districts.id"))
    ward_id = Column(Integer, ForeignKey("wards.id"))
    facility_id = Column(Integer, ForeignKey("facilities.id"))
    community_area_id = Column(Integer, ForeignKey("community_areas.id"))
    section = Column(String(20), ForeignKey("sections.code"))
    organization_id = Column(Integer, ForeignKey("organizations.id"))  # assigned payor / CSO
    start_date = Column(Date, nullable=False)
    end_date = Column(Date)
    is_primary = Column(Boolean, default=True, nullable=False)
    end_reason = Column(String(255))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = created_at()


class StaffChangeRequest(Base):
    """Payment-critical staff changes proposed by CSOs; applied only after HRH admin approval."""

    __tablename__ = "staff_change_requests"
    id = Column(Integer, primary_key=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False, index=True)
    changes = Column(JSONB, nullable=False)
    reason = Column(Text, nullable=False)
    status = Column(String(20), default="PENDING", nullable=False)
    requested_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    decided_by = Column(Integer, ForeignKey("users.id"))
    decided_at = Column(DateTime(timezone=True))
    decision_comment = Column(Text)
    created_at = created_at()


class RosterImport(Base):
    __tablename__ = "roster_imports"
    id = Column(Integer, primary_key=True)
    filename = Column(String(255))
    enrollment_source = Column(String(30), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    total_rows = Column(Integer, default=0, nullable=False)
    created_count = Column(Integer, default=0, nullable=False)
    updated_count = Column(Integer, default=0, nullable=False)
    error_count = Column(Integer, default=0, nullable=False)
    errors = Column(JSONB, default=list, nullable=False)
    created_at = created_at()
