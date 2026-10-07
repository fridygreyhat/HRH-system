"""Budget lines and an append-only ledger. FHI360 lines mirror the HQ tracker; CSO lines are tracked here."""
from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, created_at, updated_at, utcnow


class BudgetLine(Base):
    __tablename__ = "budget_lines"
    __table_args__ = (
        UniqueConstraint("code", "organization_id", "period_id", "region_id"),
        CheckConstraint("source IN ('FHI360_TRACKER', 'CSO')", name="source"),
        CheckConstraint("sync_status IN ('NOT_APPLICABLE', 'UNSYNCED', 'IMPORTED', 'EXPORTED', 'RECONCILED', 'ERROR')", name="sync_status"),
        CheckConstraint("committed_amount >= 0 AND spent_amount >= 0", name="non_negative"),
        CheckConstraint("committed_amount + spent_amount <= allocated_amount", name="within_allocation"),
    )
    id = Column(Integer, primary_key=True)
    code = Column(String(100), nullable=False)  # FHI360 tracker activity/budget-line identifier
    name = Column(String(255), nullable=False)
    source = Column(String(20), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("claim_categories.id"), nullable=False)
    period_id = Column(Integer, ForeignKey("pay_periods.id"), nullable=False)
    region_id = Column(Integer, ForeignKey("regions.id"))  # NULL = all regions
    allocated_amount = Column(Numeric(15, 2), nullable=False, default=0)
    committed_amount = Column(Numeric(15, 2), nullable=False, default=0)
    spent_amount = Column(Numeric(15, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="TZS")
    sync_status = Column(String(20), nullable=False, default="NOT_APPLICABLE")
    external_ref = Column(String(255))
    last_synced_at = Column(DateTime(timezone=True))
    created_at = created_at()
    updated_at = updated_at()


class BudgetTransaction(Base):
    """Append-only ledger (enforced by a database trigger)."""

    __tablename__ = "budget_transactions"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('ALLOCATE', 'COMMIT', 'RELEASE', 'SPEND', 'REALLOCATE_IN', 'REALLOCATE_OUT', 'IMPORT_ADJUST')",
            name="kind",
        ),
    )
    id = Column(BigInteger, primary_key=True)
    budget_line_id = Column(Integer, ForeignKey("budget_lines.id"), nullable=False, index=True)
    claim_id = Column(Integer, ForeignKey("payment_claims.id"))
    payment_record_id = Column(Integer, ForeignKey("payment_records.id"))
    kind = Column(String(20), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"))
    reason = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)


class BudgetSyncLog(Base):
    """File-based import/export runs against the FHI360 HQ tracker. No live connection exists."""

    __tablename__ = "budget_sync_logs"
    id = Column(Integer, primary_key=True)
    sync_type = Column(String(20), nullable=False)  # IMPORT, EXPORT, RECONCILE
    filename = Column(String(255))
    records_processed = Column(Integer, default=0, nullable=False)
    success_count = Column(Integer, default=0, nullable=False)
    error_count = Column(Integer, default=0, nullable=False)
    sync_status = Column(String(20), nullable=False)  # SUCCESS, PARTIAL, FAILED
    log_data = Column(JSONB)
    performed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    started_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True))
