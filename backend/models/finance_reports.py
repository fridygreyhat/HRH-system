"""Append-only Regional Finance monthly documentation approvals."""
from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text
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


class FinanceMonthlyReportWithdrawal(Base):
    """A signed Payroll month taken back because someone on it no longer has an approved timesheet (returned,
    reopened or cancelled). The sign-off stays for the record; the CSO stops seeing it until Regional Finance signs
    again. Append-only like the sign-offs."""
    __tablename__ = "finance_monthly_report_withdrawals"
    id = Column(Integer, primary_key=True)
    report_id = Column(Integer, ForeignKey("finance_monthly_reports.id"), nullable=False, unique=True)
    work_log_id = Column(Integer, ForeignKey("work_logs.id"), nullable=True)
    withdrawn_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    withdrawn_at = created_at()
    reason = Column(Text, nullable=False)
