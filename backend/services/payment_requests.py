"""Central Finance records the PRF it raised for a downloaded Services report.

A PRF names the claims in one download, and each claim can be on one PRF only. The report leaves out claims that
already have a PRF, so the next download is exactly the money not yet requested.
"""
from fastapi import HTTPException
from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError

from ..core import audit
from ..core.timeutil import local_today
from ..models import PaymentClaim, PaymentRequestForm, PaymentRequestFormClaim, ServicesReportDownload, User, WorkLog
from . import central_review
from .v22_scope import record_condition


def _visible_claims(current):
    cadre = select(WorkLog.cadre_id).where(WorkLog.id == PaymentClaim.work_log_id).scalar_subquery()
    return record_condition(current, PaymentClaim.assignment_id, cadre)


def prf_out(db, prf: PaymentRequestForm) -> dict:
    paid = (db.query(PaymentClaim).join(PaymentRequestFormClaim, PaymentRequestFormClaim.claim_id == PaymentClaim.id)
            .filter(PaymentRequestFormClaim.prf_id == prf.id, PaymentClaim.payment_status.in_(("PAID", "RECONCILED"))).count())
    return {"paid_count": paid,"id": prf.id, "prf_number": prf.prf_number, "prf_date": prf.prf_date, "month": prf.month, "region_id": prf.region_id,
            "amounts": prf.amounts, "claim_count": prf.claim_count, "note": prf.note, "download_id": prf.download_id,
            "recorded_by": db.get(User, prf.recorded_by).full_name, "recorded_at": prf.created_at}


def download_out(db, current, download_id: int) -> dict:
    download = db.get(ServicesReportDownload, download_id)
    if download is None or (download.downloaded_by != current.id and not current.unrestricted):
        raise HTTPException(404, "Download not found. Download the Services report again.")
    prf = db.query(PaymentRequestForm).filter_by(download_id=download.id).first()
    waiting = db.query(PaymentClaim).filter(PaymentClaim.id.in_(download.claim_ids), PaymentClaim.status == central_review.PENDING).count()
    return {"id": download.id, "awaiting_review": waiting, "month": download.month, "region_id": download.region_id, "format": download.format,
            "row_count": download.row_count, "claim_count": len(download.claim_ids), "amounts": download.amounts,
            "downloaded_at": download.created_at, "prf": prf_out(db, prf) if prf else None}


def record(db, current, download_id: int, prf_number: str, prf_date, note: str | None) -> dict:
    download = (db.query(ServicesReportDownload).filter_by(id=download_id).with_for_update().first())
    if download is None or (download.downloaded_by != current.id and not current.unrestricted):
        raise HTTPException(404, "Download not found. Download the Services report again.")
    if prf_date > local_today():
        raise HTTPException(422, "The PRF date cannot be in the future.")
    existing = db.query(PaymentRequestForm).filter_by(download_id=download.id).first()
    if existing:
        raise HTTPException(409, f"This download is already recorded as PRF {existing.prf_number}.")
    if db.query(exists().where(PaymentRequestForm.prf_number == prf_number)).scalar():
        raise HTTPException(409, f"PRF {prf_number} is already recorded. Check the number.")
    claims = db.query(PaymentClaim).filter(PaymentClaim.id.in_(download.claim_ids)).with_for_update().all()
    waiting = sum(1 for claim in claims if claim.status == central_review.PENDING)
    if waiting:
        raise HTTPException(409, f"{waiting} claim(s) in this download still await Central Finance review. Approve them first, "
                                 "then download the report again and record the PRF from the new file.")
    if len(claims) != len(download.claim_ids) or any(claim.status == "CANCELLED" for claim in claims):
        raise HTTPException(409, "A claim in this download has since been cancelled. Download the report again and raise the PRF from the new file.")
    taken = (db.query(PaymentRequestForm.prf_number).join(PaymentRequestFormClaim, PaymentRequestFormClaim.prf_id == PaymentRequestForm.id)
             .filter(PaymentRequestFormClaim.claim_id.in_(download.claim_ids)).distinct().all())
    if taken:
        raise HTTPException(409, f"Some claims in this download are already on PRF {', '.join(sorted(n for (n,) in taken))}. "
                                 "Download the report again: it leaves those claims out.")
    prf = PaymentRequestForm(prf_number=prf_number, prf_date=prf_date, download_id=download.id, month=download.month,
                             region_id=download.region_id, amounts=download.amounts, claim_count=len(download.claim_ids),
                             note=note, recorded_by=current.id)
    db.add(prf)
    try:
        db.flush()
        db.add_all(PaymentRequestFormClaim(claim_id=claim_id, prf_id=prf.id) for claim_id in download.claim_ids)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Another PRF was just recorded for these claims or with this number. Refresh and check.")
    audit.record(db, current, "payment_request_form", prf.id, "record_prf",
                 after={"prf_number": prf_number, "month": download.month, "region_id": download.region_id,
                        "claim_ids": download.claim_ids, "amounts": download.amounts, "download_id": download.id})
    db.commit()
    return prf_out(db, prf)


def for_month(db, current, month: str) -> list[dict]:
    """PRFs for the month that hold at least one claim in the caller's finance scope."""
    visible = (select(PaymentRequestFormClaim.prf_id).join(PaymentClaim, PaymentClaim.id == PaymentRequestFormClaim.claim_id)
               .where(_visible_claims(current)))
    rows = (db.query(PaymentRequestForm).filter(PaymentRequestForm.month == month, PaymentRequestForm.id.in_(visible))
            .order_by(PaymentRequestForm.prf_date, PaymentRequestForm.id))
    return [prf_out(db, prf) for prf in rows]
