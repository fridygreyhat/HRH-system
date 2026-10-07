from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, created_at, utcnow


class AuditEvent(Base):
    """Append-only system audit (configuration, assignments, exports, budget, proof, sensitive-field access)."""

    __tablename__ = "audit_events"
    id = Column(BigInteger, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id"))
    actor_roles = Column(String(255))
    entity_type = Column(String(50), nullable=False, index=True)
    entity_id = Column(String(50))
    action = Column(String(50), nullable=False)
    before = Column(JSONB)
    after = Column(JSONB)
    reason = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class SystemSetting(Base):
    __tablename__ = "system_settings"
    key = Column(String(100), primary_key=True)
    value = Column(JSONB, nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"))
    updated_at = created_at()
