"""Provider period work logs, daily entries/measures, frozen review versions, approvals and OTP."""
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, created_at, updated_at, utcnow


class PayPeriod(Base):
    __tablename__ = "pay_periods"
    __table_args__ = (
        UniqueConstraint("start_date", "end_date"),
        CheckConstraint("end_date >= start_date", name="dates"),
        CheckConstraint("status IN ('OPEN', 'CLOSED')", name="status"),
    )
    id = Column(Integer, primary_key=True)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    period_label = Column(String(100))
    status = Column(String(20), default="OPEN", nullable=False)
    created_at = created_at()


class WorkLog(Base):
    __tablename__ = "work_logs"
    __table_args__ = (UniqueConstraint("staff_id", "period_id"),)
    id = Column(Integer, primary_key=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False, index=True)
    period_id = Column(Integer, ForeignKey("pay_periods.id"), nullable=False, index=True)
    # The assignment in force for this period, captured at creation so rotations don't rewrite history.
    assignment_id = Column(Integer, ForeignKey("staff_assignments.id"), nullable=False)
    cadre_id = Column(Integer, ForeignKey("cadres.id"), nullable=False)
    occupation = Column(String(100))
    occupation_other = Column(String(100))
    section = Column(String(20), ForeignKey("sections.code"))
    status = Column(String(50), nullable=False, default="DRAFT", index=True)
    version = Column(Integer, nullable=False, default=0)  # increments each time a CTC verification freezes a snapshot
    confirmed_version = Column(Integer)  # version the provider confirmed by OTP
    period_comment = Column(Text)
    attested_at = Column(DateTime(timezone=True))
    submit_gps_lat = Column(Numeric(10, 8))
    submit_gps_lon = Column(Numeric(11, 8))
    submit_gps_accuracy_m = Column(Numeric(8, 2))
    submitted_at = Column(DateTime(timezone=True))
    approved_at = Column(DateTime(timezone=True))
    status_changed_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    created_at = created_at()
    updated_at = updated_at()


class WorkLogEntry(Base):
    __tablename__ = "work_log_entries"
    __table_args__ = (
        UniqueConstraint("work_log_id", "entry_date"),
        CheckConstraint("hours_worked > 0 AND hours_worked <= 24", name="hours"),
    )
    id = Column(Integer, primary_key=True)
    work_log_id = Column(Integer, ForeignKey("work_logs.id", ondelete="CASCADE"), nullable=False, index=True)
    entry_date = Column(Date, nullable=False)
    start_time = Column(Time)
    end_time = Column(Time)
    hours_worked = Column(Numeric(5, 2), nullable=False)
    evidence_text = Column(Text, nullable=False)
    comment = Column(Text)
    gps_lat = Column(Numeric(10, 8))
    gps_lon = Column(Numeric(11, 8))
    gps_accuracy_m = Column(Numeric(8, 2))
    gps_captured_at = Column(DateTime(timezone=True))
    # WITHIN_GEOFENCE, OUTSIDE_GEOFENCE, NO_GPS, NO_GEOFENCE, COMMUNITY_REVIEW, NOT_CAPTURED
    location_status = Column(String(30), nullable=False, default="NOT_CAPTURED")
    created_at = created_at()
    updated_at = updated_at()


class WorkLogMeasure(Base):
    __tablename__ = "work_log_measures"
    __table_args__ = (UniqueConstraint("entry_id", "field_key"), CheckConstraint("value >= 0", name="value"))
    id = Column(Integer, primary_key=True)
    entry_id = Column(Integer, ForeignKey("work_log_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    field_key = Column(String(80), nullable=False)
    value = Column(Numeric(10, 2), nullable=False, default=0)


class WorkLogVersion(Base):
    """Frozen snapshot created at CTC verification; the provider confirms exactly this version."""

    __tablename__ = "work_log_versions"
    __table_args__ = (UniqueConstraint("work_log_id", "version"),)
    id = Column(Integer, primary_key=True)
    work_log_id = Column(Integer, ForeignKey("work_logs.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    snapshot = Column(JSONB, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()


class WorkLogAudit(Base):
    """Append-only (enforced by a database trigger)."""

    __tablename__ = "work_log_audit"
    id = Column(BigInteger, primary_key=True)
    work_log_id = Column(Integer, ForeignKey("work_logs.id"), nullable=False, index=True)
    version = Column(Integer)
    actor_id = Column(Integer, ForeignKey("users.id"))
    actor_role = Column(String(50))
    action = Column(String(50), nullable=False)
    old_status = Column(String(50))
    new_status = Column(String(50))
    comment = Column(Text)
    details = Column(JSONB)
    timestamp = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class WorkLogEndorsement(Base):
    """Supplemental endorsements from the paper forms (e.g. Facility In-Charge) — not a status change."""

    __tablename__ = "work_log_endorsements"
    __table_args__ = (UniqueConstraint("work_log_id", "version", "kind"),)
    id = Column(Integer, primary_key=True)
    work_log_id = Column(Integer, ForeignKey("work_logs.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    kind = Column(String(50), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    comment = Column(Text)
    created_at = created_at()


class OTPChallenge(Base):
    __tablename__ = "otp_challenges"
    id = Column(Integer, primary_key=True)
    work_log_id = Column(Integer, ForeignKey("work_logs.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    code_hash = Column(String(128), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    is_used = Column(Boolean, default=False, nullable=False)
    created_at = created_at()
