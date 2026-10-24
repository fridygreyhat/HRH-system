"""Immutable scoped activity/rate versions. Entry snapshots preserve the rate used."""
from sqlalchemy import Boolean, CheckConstraint, Column, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, created_at


class ActivityRate(Base):
    __tablename__ = "activity_rates"
    __table_args__ = (
        CheckConstraint("item_type IN ('SERVICES', 'PAYROLL')", name="item_type"),
        CheckConstraint("form_mode IN ('CASCADE', 'SINGLE')", name="form_mode"),
        CheckConstraint("rate_value >= 0", name="rate"),
        CheckConstraint("unit_type IN ('PER_UNIT', 'PER_HOUR', 'PER_DAY')", name="unit_type"),
    )
    id = Column(Integer, primary_key=True)
    key = Column(String(80), unique=True, nullable=False)
    source_key = Column(String(80))
    label_en = Column(String(255), nullable=False)
    label_sw = Column(String(255), nullable=False)
    cadre_id = Column(Integer, ForeignKey("cadres.id"), nullable=False, index=True)
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=False, index=True)
    item_type = Column(String(20), nullable=False)
    form_mode = Column(String(20), nullable=False)
    field_definitions = Column(JSONB, nullable=False)
    hours_input = Column(Boolean, nullable=False, default=False)
    rate_value = Column(Numeric(15, 2), nullable=False)
    currency = Column(String(10), nullable=False, default="TZS")
    unit_type = Column(String(20), nullable=False)
    billable_field = Column(String(80))
    is_active = Column(Boolean, nullable=False, default=True)
    effective_start_date = Column(Date, nullable=False)
    supersedes_id = Column(Integer, ForeignKey("activity_rates.id"))
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()
