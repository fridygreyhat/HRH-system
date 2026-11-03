"""Monthly regional Services ceilings and claim-linked submission deductions."""
from sqlalchemy import Column, Integer, String, Numeric, ForeignKey, UniqueConstraint, CheckConstraint, LargeBinary, DateTime
from .base import Base, created_at, updated_at


class MonthlyServiceBudget(Base):
    __tablename__ = "monthly_service_budgets"
    __table_args__ = (
        UniqueConstraint("region_id", "month", "currency"),
        CheckConstraint("allocated_amount >= 0 AND deducted_amount >= 0 AND deducted_amount <= allocated_amount", name="monthly_services_balance"),
    )
    id = Column(Integer, primary_key=True)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False, index=True)
    month = Column(String(7), nullable=False)
    currency = Column(String(3), nullable=False)
    allocated_amount = Column(Numeric(15, 2), nullable=False)
    deducted_amount = Column(Numeric(15, 2), nullable=False, default=0)
    document_name = Column(String(255), nullable=False)
    document_type = Column(String(100), nullable=False)
    document_data = Column(LargeBinary, nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_at = updated_at()
    created_at = created_at()


class MonthlyServiceBudgetCharge(Base):
    __tablename__ = "monthly_service_budget_charges"
    __table_args__ = (UniqueConstraint("budget_id", "claim_id"),
                      CheckConstraint("amount > 0", name="monthly_services_charge_positive"))
    id = Column(Integer, primary_key=True)
    budget_id = Column(Integer, ForeignKey("monthly_service_budgets.id"), nullable=False, index=True)
    claim_id = Column(Integer, ForeignKey("payment_claims.id"), nullable=False, index=True)
    amount = Column(Numeric(15, 2), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()
    released_at = Column(DateTime(timezone=True))
