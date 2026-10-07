from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from .base import Base, created_at


class SMSTemplate(Base):
    """Versioned: an edit inserts a new version and deactivates the previous one."""

    __tablename__ = "sms_templates"
    __table_args__ = (UniqueConstraint("event_name", "language", "version"),)
    id = Column(Integer, primary_key=True)
    event_name = Column(String(100), nullable=False)
    language = Column(String(5), nullable=False)
    version = Column(Integer, nullable=False)
    template_text = Column(Text, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = created_at()


class SMSOutbox(Base):
    __tablename__ = "sms_outbox"
    id = Column(Integer, primary_key=True)
    event_name = Column(String(100), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    destination_phone = Column(String(20), nullable=False)
    language = Column(String(5))
    template_id = Column(Integer, ForeignKey("sms_templates.id"))
    message_body = Column(Text, nullable=False)  # never contains OTP codes (redacted)
    status = Column(String(20), nullable=False, default="PENDING", index=True)  # PENDING, SENT, FAILED, SUPPRESSED
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime(timezone=True))
    last_error = Column(Text)
    provider_message_id = Column(String(255))
    # The record and status that triggered the message; used to suppress stale messages.
    related_type = Column(String(30))
    related_id = Column(Integer)
    related_status = Column(String(50))
    created_at = created_at()
    sent_at = Column(DateTime(timezone=True))
