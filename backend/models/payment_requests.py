"""Central Finance's Payment Request Forms (PRF) for Services, tied to the exact report that was downloaded."""
from sqlalchemy import Column, Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB

from .base import Base, created_at


class ServicesReportDownload(Base):
    """What one Services payment report download contained, so a PRF can name exactly those claims."""
    __tablename__ = "services_report_downloads"
    id = Column(Integer, primary_key=True)
    month = Column(String(7), nullable=False)
    region_id = Column(Integer, ForeignKey("regions.id"))
    format = Column(String(4), nullable=False)
    claim_ids = Column(JSONB, nullable=False)
    row_count = Column(Integer, nullable=False)
    amounts = Column(JSONB, nullable=False)  # {currency: total}
    downloaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()


class PaymentRequestForm(Base):
    __tablename__ = "payment_request_forms"
    id = Column(Integer, primary_key=True)
    prf_number = Column(String(50), unique=True, nullable=False)
    prf_date = Column(Date, nullable=False)
    download_id = Column(Integer, ForeignKey("services_report_downloads.id"), unique=True, nullable=False)
    month = Column(String(7), nullable=False, index=True)
    region_id = Column(Integer, ForeignKey("regions.id"))
    amounts = Column(JSONB, nullable=False)
    claim_count = Column(Integer, nullable=False)
    note = Column(Text)
    recorded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = created_at()


class PaymentRequestFormClaim(Base):
    """A claim is requested once: the primary key on claim_id stops a second PRF for the same money."""
    __tablename__ = "payment_request_form_claims"
    claim_id = Column(Integer, ForeignKey("payment_claims.id"), primary_key=True)
    prf_id = Column(Integer, ForeignKey("payment_request_forms.id"), nullable=False, index=True)
