"""Salary payments a CSO records against a signed Payroll month, and Central Finance's monthly reconciliation sign-off."""
from sqlalchemy import CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, created_at


class PayrollPayment(Base):
    """One provider's salary payment for a pay month, made by their CSO outside the app and recorded here.

    Never deleted: a mistake is voided with a reason, so the audit trail keeps what was recorded and by whom."""

    __tablename__ = "payroll_payments"
    __table_args__ = (
        CheckConstraint("status IN ('PAID', 'FAILED')", name="status"),
        CheckConstraint("amount >= 0 AND (status <> 'PAID' OR amount > 0)", name="amount"),
        CheckConstraint("payment_method IN ('BANK', 'MOBILE_WALLET')", name="method"),
        Index("ix_payroll_payments_month_region", "month", "region_id"),
        Index("ix_payroll_payments_staff_month", "staff_id", "month"),
    )
    id = Column(Integer, primary_key=True)
    month = Column(String(7), nullable=False)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False)
    report_id = Column(Integer, ForeignKey("finance_monthly_reports.id"), nullable=False)  # the sign-off paid against
    expected_amount = Column(Numeric(15, 2))  # the signed salary when the payment was recorded
    amount = Column(Numeric(15, 2), nullable=False)
    currency = Column(String(10), nullable=False, default="TZS")
    status = Column(String(10), nullable=False)
    payment_date = Column(Date, nullable=False)
    payment_reference = Column(String(200), nullable=False)
    payment_method = Column(String(20), nullable=False)
    pay_components = Column(JSONB)  # the CHW package parts when the payment was recorded
    # One bank schedule can prove many payments: the same stored file on each row.
    proof_key = Column(String(255))
    proof_filename = Column(String(255))
    proof_content_type = Column(String(100))
    proof_size_bytes = Column(Integer)
    proof_sha256 = Column(String(64))
    recorded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()
    voided_at = Column(DateTime(timezone=True))
    voided_by = Column(Integer, ForeignKey("users.id"))
    void_reason = Column(Text)


class FinanceReconciliation(Base):
    """Central Finance confirms a month's Payroll and Services reconcile. Append-only: a later sign-off supersedes."""

    __tablename__ = "finance_reconciliations"
    __table_args__ = (Index("ix_finance_reconciliations_month", "month", "region_id", "id"),)
    id = Column(Integer, primary_key=True)
    month = Column(String(7), nullable=False)
    region_id = Column(Integer, ForeignKey("regions.id"))  # NULL: every region
    digest = Column(String(64), nullable=False)
    totals = Column(JSONB, nullable=False)
    issue_count = Column(Integer, nullable=False)
    note = Column(Text)
    signed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    signed_at = created_at()
