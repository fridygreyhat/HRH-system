"""Append-only Regional Finance monthly documentation approvals."""
from sqlalchemy import Column, ForeignKey, Integer, String, Index
from sqlalchemy.dialects.postgresql import JSONB
from .base import Base, created_at


class FinanceMonthlyReport(Base):
    __tablename__ = "finance_monthly_reports"
    __table_args__ = (Index("ix_finance_monthly_report_lookup", "region_id", "month", "work_type", "id"),)
    id = Column(Integer, primary_key=True)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False)
    month = Column(String(7), nullable=False)
    work_type = Column(String(16), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_at = created_at()
    digest = Column(String(64), nullable=False)
    snapshot = Column(JSONB, nullable=False)
