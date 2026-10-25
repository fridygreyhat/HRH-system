from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String
from .base import Base, created_at


class BackdateAccess(Base):
    """Temporary permission for one provider to enter one missed work date."""
    __tablename__ = "backdate_access"
    id = Column(Integer, primary_key=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False, index=True)
    assignment_id = Column(Integer, ForeignKey("staff_assignments.id"), nullable=False)
    entry_date = Column(Date, nullable=False)
    granted_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    reason = Column(String(1000), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True))
    created_at = created_at()
