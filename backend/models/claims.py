"""Payment claims (separate from work logs), routes A/B/C, rate rules, payroll batches, payments and proof."""
from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    BigInteger,
    Boolean,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, created_at, updated_at, utcnow

ROUTE_CODES = ("A", "B", "C")


class PaymentRoute(Base):
    __tablename__ = "payment_routes"
    id = Column(Integer, primary_key=True)
    code = Column(String(5), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text)


class FundingSource(Base):
    __tablename__ = "funding_sources"
    id = Column(Integer, primary_key=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(255), nullable=False)


class ClaimCategory(Base):
    __tablename__ = "claim_categories"
    __table_args__ = (
        CheckConstraint("budget_owner IN ('PAYOR', 'EXECUTOR')", name="budget_owner"),
        CheckConstraint("origin_channel IN ('FACILITY', 'COMMUNITY')", name="origin_channel"),
    )
    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    # SALARY (monthly timesheet) and SERVICES claims are created on RPM approval; others (CHW_PNP, HCP_PNP, ...) by finance.
    form_type = Column(String(50))
    route_id = Column(Integer, ForeignKey("payment_routes.id"))  # NULL = not configured → exception
    funding_source_id = Column(Integer, ForeignKey("funding_sources.id"))
    payor_org_id = Column(Integer, ForeignKey("organizations.id"))  # Route A/B final payor; NULL for C (assigned CSO)
    budget_owner = Column(String(20), nullable=False, default="PAYOR")
    origin_channel = Column(String(20), nullable=False, default="FACILITY")
    budget_line_code = Column(String(100))
    requires_work_log = Column(Boolean, nullable=False, default=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = created_at()


class RateRule(Base):
    """Effective-dated, approved rate. Only ACTIVE rules are ever used in a calculation."""

    __tablename__ = "rate_rules"
    __table_args__ = (
        CheckConstraint("unit_type IN ('PER_DAY', 'PER_HOUR', 'PER_UNIT', 'FIXED')", name="unit_type"),
        CheckConstraint("status IN ('PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'RETIRED')", name="status"),
        CheckConstraint("unit_type <> 'PER_UNIT' OR measure_key IS NOT NULL", name="measure"),
        CheckConstraint("rate_value >= 0", name="rate"),
    )
    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, ForeignKey("claim_categories.id"), nullable=False, index=True)
    cadre_id = Column(Integer, ForeignKey("cadres.id"))  # NULL = any cadre
    region_id = Column(Integer, ForeignKey("regions.id"))  # NULL = any region
    facility_id = Column(Integer, ForeignKey("facilities.id"))  # NULL = any facility (e.g. per-facility service rates)
    component_name = Column(String(255), nullable=False)
    unit_type = Column(String(20), nullable=False)
    measure_key = Column(String(80))
    rate_value = Column(Numeric(15, 2), nullable=False)
    currency = Column(String(10), nullable=False, default="TZS")
    cap_amount = Column(Numeric(15, 2))
    effective_start_date = Column(Date, nullable=False)
    effective_end_date = Column(Date)
    status = Column(String(20), nullable=False, default="PENDING_APPROVAL")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    created_at = created_at()


class PaymentClaim(Base):
    __tablename__ = "payment_claims"
    __table_args__ = (
        CheckConstraint(f"route_code IS NULL OR route_code IN {ROUTE_CODES}", name="route"),
        CheckConstraint("amount >= 0", name="amount"),
        # Duplicate prevention: one live claim per staff member, category and period.
        Index(
            "uq_payment_claims_live",
            "staff_id",
            "category_id",
            "period_id",
            unique=True,
            postgresql_where=text("status <> 'CANCELLED'"),
        ),
    )
    id = Column(Integer, primary_key=True)
    work_log_id = Column(Integer, ForeignKey("work_logs.id"), index=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("claim_categories.id"), nullable=False)
    period_id = Column(Integer, ForeignKey("pay_periods.id"), nullable=False)
    assignment_id = Column(Integer, ForeignKey("staff_assignments.id"))
    community_area_id = Column(Integer, ForeignKey("community_areas.id"))
    route_code = Column(String(5))
    funding_source_id = Column(Integer, ForeignKey("funding_sources.id"))
    payor_org_id = Column(Integer, ForeignKey("organizations.id"))
    executor_org_id = Column(Integer, ForeignKey("organizations.id"), index=True)
    budget_line_id = Column(Integer, ForeignKey("budget_lines.id"))
    origin_channel = Column(String(20))
    evidence_text = Column(Text)
    declared_units = Column(JSONB)  # payable units entered for claims not based on an HRH work log
    amount = Column(Numeric(15, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="TZS")
    status = Column(String(40), nullable=False, default="DRAFT", index=True)
    payment_status = Column(String(40), nullable=False, default="NOT_STARTED", index=True)
    exception_reason = Column(Text)
    calculation_snapshot = Column(JSONB)
    batch_id = Column(Integer, ForeignKey("payroll_batches.id"), index=True)
    origin = Column(String(20), nullable=False, default="MANUAL", server_default="MANUAL")  # MANUAL | RPM_APPROVAL
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    verified_by = Column(Integer, ForeignKey("users.id"))
    verified_at = Column(DateTime(timezone=True))
    approved_by = Column(Integer, ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    created_at = created_at()
    updated_at = updated_at()


class ClaimComponent(Base):
    __tablename__ = "claim_components"
    id = Column(Integer, primary_key=True)
    claim_id = Column(Integer, ForeignKey("payment_claims.id", ondelete="CASCADE"), nullable=False, index=True)
    rate_rule_id = Column(Integer, ForeignKey("rate_rules.id"))
    component_name = Column(String(255), nullable=False)
    unit_type = Column(String(20))
    measure_key = Column(String(80))
    units = Column(Numeric(12, 2), nullable=False)
    rate = Column(Numeric(15, 2), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)


class ClaimAudit(Base):
    """Append-only (enforced by a database trigger)."""

    __tablename__ = "claim_audit"
    id = Column(BigInteger, primary_key=True)
    claim_id = Column(Integer, ForeignKey("payment_claims.id"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"))
    actor_role = Column(String(50))
    action = Column(String(50), nullable=False)
    old_status = Column(String(40))
    new_status = Column(String(40))
    old_payment_status = Column(String(40))
    new_payment_status = Column(String(40))
    comment = Column(Text)
    details = Column(JSONB)
    timestamp = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class PayrollBatch(Base):
    __tablename__ = "payroll_batches"
    id = Column(Integer, primary_key=True)
    reference = Column(String(50), unique=True, nullable=False)
    route_code = Column(String(5), nullable=False)
    payor_org_id = Column(Integer, ForeignKey("organizations.id"))
    executor_org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    status = Column(String(30), nullable=False, default="EXPORTED")  # EXPORTED, HANDED_OFF, RECEIVED
    line_count = Column(Integer, nullable=False, default=0)
    total_amount = Column(Numeric(15, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="TZS")
    export_snapshot = Column(JSONB, nullable=False)  # immutable copy of what was exported
    export_csv = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()
    handed_off_by = Column(Integer, ForeignKey("users.id"))
    handed_off_at = Column(DateTime(timezone=True))
    received_by = Column(Integer, ForeignKey("users.id"))
    received_at = Column(DateTime(timezone=True))


class PaymentRecord(Base):
    """A payment executed outside the app (MVP never initiates transfers)."""

    __tablename__ = "payment_records"
    __table_args__ = (
        CheckConstraint("status IN ('PAID', 'PARTIAL', 'FAILED')", name="status"),
        CheckConstraint("amount >= 0", name="amount"),
    )
    id = Column(Integer, primary_key=True)
    claim_id = Column(Integer, ForeignKey("payment_claims.id"), nullable=False, index=True)
    executor_org_id = Column(Integer, ForeignKey("organizations.id"))
    payment_reference = Column(String(255), nullable=False)
    payment_method = Column(String(50))
    amount = Column(Numeric(15, 2), nullable=False)
    payment_date = Column(Date, nullable=False)
    status = Column(String(20), nullable=False)
    recorded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()


class PaymentProof(Base):
    __tablename__ = "payment_proofs"
    id = Column(Integer, primary_key=True)
    claim_id = Column(Integer, ForeignKey("payment_claims.id"), nullable=False, index=True)
    payment_record_id = Column(Integer, ForeignKey("payment_records.id"))
    storage_key = Column(String(255), nullable=False, unique=True)
    original_filename = Column(String(255), nullable=False)
    content_type = Column(String(100), nullable=False)
    size_bytes = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()
