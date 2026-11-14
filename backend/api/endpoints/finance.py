"""Assignment-aware Regional Finance routing, using the existing approval and budget gate."""
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ...core import audit
from ...core.roles import REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE
from ...core.security import require_roles
from ...core.serialize import to_dict
from ...core.timeutil import local_today
from ...db.session import get_db
from ...models import Cadre, ClaimCategory, Facility, FundingSource, PaymentClaim, PayPeriod, Region, Staff, StaffAssignment, WorkLog
from ...services import finance_gate, payment_requests, worklog_workflow as wf
from ...services.v22_scope import record_condition, regions_for
from ...services import monthly_report_approval as monthly_reports
from ...services.monthly_report_exports import csv_file, pdf_file
from .provider_payment_details import private_response

router = APIRouter()
MEDIA = {"csv": "text/csv; charset=utf-8", "pdf": "application/pdf",
         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


class MonthlyApprovalIn(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    region_id: int = Field(gt=0)
    work_type: Literal["SERVICES", "PAYROLL"]
    review_confirmed: bool
    expected_digest: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


@router.get("/services-payment-report/export")
def export_services_payment_report(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    region_id: Optional[int] = Query(default=None, gt=0),
    format: Literal["csv", "pdf", "xlsx"] = "csv",
    include_prf: bool = False,
    timesheets: bool = False,
    db: Session = Depends(get_db),
    current=Depends(require_roles(FHI360_FINANCE)),
):
    """CSV is the detailed data file; PDF and Excel are the payment form, one row per person, as Finance signs it.
    PDF with timesheets=true puts each person's Services timesheet first and the payment form last."""
    from ...services import payment_forms, services_finance_exports as exports
    if format == "csv":
        rows = exports.rows(db, current, month, region_id, include_prf)
        payload = exports.csv_file(rows)
    else:
        form = payment_forms.services_form(db, current, month, region_id, include_prf)
        rows = form["report_rows"]
        if not rows:
            waiting = form["awaiting_central_review"]["claims"]
            raise HTTPException(404, f"No Services approved by Central Finance for this month yet. "
                                     f"{waiting} routed {'claim awaits' if waiting == 1 else 'claims await'} Central Finance approval.")
        if format == "pdf" and timesheets:
            from ...services.salary_timesheets import MAX_PDF_PROVIDERS
            if len(form["rows"]) > MAX_PDF_PROVIDERS:
                raise HTTPException(422, f"This PDF would have {len(form['rows']):,} timesheet pages. Choose a region to keep it "
                                         f"under {MAX_PDF_PROVIDERS:,} providers. The payment form alone includes everyone.")
            payload = payment_forms.services_pack_pdf(db, current, form, month, region_id)
        else:
            payload = payment_forms.pdf_file(form) if format == "pdf" else payment_forms.xlsx_file(form)
    download = exports.record_download(db, current, month, region_id, format, rows)
    audit.record(db, current, "services_payment_report", month, "download",
                 after={"format": format, "region_id": region_id, "rows": len(rows), "include_prf": include_prf, "download_id": download.id})
    db.commit()
    name = (f"services-payment-{month}.csv" if format == "csv" else f"services-timesheets-and-payment-form-{month}.pdf"
            if timesheets and format == "pdf" else f"services-payment-form-{month}.{format}")
    return Response(payload, media_type=MEDIA[format],
                    headers={"Content-Disposition": f'attachment; filename="{name}"',
                             "X-Download-Id": str(download.id),
                             "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/services-payment-form", dependencies=[Depends(private_response)])
def services_payment_form(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    region_id: Optional[int] = Query(default=None, gt=0),
    include_prf: bool = False,
    db: Session = Depends(get_db),
    current=Depends(require_roles(FHI360_FINANCE)),
):
    """The Services payment form on screen: what the PDF and Excel downloads contain."""
    from ...services import payment_forms
    return payment_forms.screen(payment_forms.services_form(db, current, month, region_id, include_prf))


class PrfIn(BaseModel):
    download_id: int = Field(gt=0)
    prf_number: str = Field(min_length=1, max_length=50, pattern=r"^[A-Za-z0-9][A-Za-z0-9 /._-]*$")
    prf_date: date
    note: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("prf_number", "note", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() or None if isinstance(value, str) else value


@router.get("/services-payment-report/downloads/{download_id}")
def services_report_download(download_id: int, db: Session = Depends(get_db), current=Depends(require_roles(FHI360_FINANCE))):
    return payment_requests.download_out(db, current, download_id)


@router.post("/services-payment-report/prf", status_code=201)
def record_prf(body: PrfIn, db: Session = Depends(get_db), current=Depends(require_roles(FHI360_FINANCE))):
    """After downloading the Services report, Central Finance records the PRF raised for exactly those claims."""
    return payment_requests.record(db, current, body.download_id, body.prf_number, body.prf_date, body.note)


@router.get("/services-payment-report/prf/{prf_id}/claims")
def prf_beneficiaries(prf_id: int, db: Session = Depends(get_db), current=Depends(require_roles(FHI360_FINANCE))):
    from ...services import services_payment_proofs
    return services_payment_proofs.prf_beneficiaries(db, current, prf_id)


@router.post("/services-payment-report/prf/{prf_id}/proof", status_code=201)
def prf_proof_payment(
    prf_id: int,
    file: UploadFile = File(...),
    payment_reference: str = Form(..., max_length=200),
    payment_date: date = Form(...),
    beneficiaries_confirmed: bool = Form(default=False),
    payment_method: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    current=Depends(require_roles(FHI360_FINANCE)),
):
    """After paying a PRF, Central Finance uploads one proof for all its unpaid claims; each gets its payment record."""
    from ...services import services_payment_proofs
    if payment_date > local_today():
        raise HTTPException(422, "The payment date cannot be in the future.")
    paid = services_payment_proofs.record_prf_proof(db, current, prf_id, file, payment_reference, payment_date,
                                                    beneficiaries_confirmed, payment_method)
    return {"paid_claim_ids": paid, "paid_count": len(paid)}


@router.get("/services-payment-report/prfs")
def list_prfs(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), db: Session = Depends(get_db),
              current=Depends(require_roles(FHI360_FINANCE))):
    return payment_requests.for_month(db, current, month)


@router.get("/monthly-report")
def monthly_report(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    region_id: Optional[int] = Query(default=None, gt=0),
    work_type: Literal["SERVICES", "PAYROLL"] = "PAYROLL",
    db: Session = Depends(get_db),
    current=Depends(require_roles(REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE)),
):
    return monthly_reports.view(db, current, month, region_id, work_type)


@router.get("/monthly-report/status")
def monthly_report_status(db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    """Which regional Payroll and Services reports of the recent pay months are signed, and which still wait."""
    return monthly_reports.signoff_status(db, current)


@router.post("/monthly-report/approve")
def approve_monthly_report(
    data: MonthlyApprovalIn,
    db: Session = Depends(get_db),
    current=Depends(require_roles(REGIONAL_FINANCE)),
):
    return monthly_reports.approve(db, current, data)


@router.get("/monthly-report/export")
def export_monthly_report(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    region_id: int = Query(gt=0),
    work_type: Literal["SERVICES", "PAYROLL"] = "PAYROLL",
    format: Literal["csv", "pdf"] = "csv",
    db: Session = Depends(get_db),
    current=Depends(require_roles(REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE)),
):
    result = monthly_reports.view(db, current, month, region_id, work_type)
    if not result["report"]["providers"]:
        raise HTTPException(404, "No authorized approved monthly work is available to export.")
    region = db.query(Region).filter_by(id=region_id).one()
    filename = f"regional-work-{month}-{work_type.lower()}-region-{region_id}.{format}"
    payload = csv_file(result, region.name) if format == "csv" else pdf_file(result, region.name)
    return Response(payload, media_type="text/csv; charset=utf-8" if format == "csv" else "application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"',
                             "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


class ChannelIn(BaseModel):
    claim_id: Optional[int] = Field(default=None, gt=0)
    work_log_id: Optional[int] = Field(default=None, gt=0)
    target_payor_id: int = Field(gt=0)
    central_reviewer_id: Optional[int] = Field(default=None, gt=0)
    expected_version: Optional[int] = Field(default=None, ge=0)
    expected_review_token: Optional[str] = Field(default=None, min_length=1, max_length=64)
    review_confirmed: bool = False
    review_type: Literal["SERVICES", "PAYROLL"]
    comment: Optional[str] = Field(default=None, max_length=2000)


class FundingAssignmentIn(BaseModel):
    funding_source_id: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=1000)


@router.put("/categories/{category_id}/funding-source")
def assign_initial_funding(
    category_id: int, body: FundingAssignmentIn,
    db: Session = Depends(get_db), current=Depends(require_roles(FHI360_FINANCE)),
):
    """Explicit initial configuration only; never silently reclassify live claims."""
    category = db.query(ClaimCategory).filter_by(id=category_id).with_for_update().first()
    if not category:
        raise HTTPException(404, "Budget category not found")
    if (not category.is_active or category.origin_channel == "COMMUNITY"
            or (category.form_type or "").upper() in {"PAYROLL", "SALARY", "STIPEND", "STIPENDS", "TIMESHEET"}):
        raise HTTPException(422, "Select an active Services work-log budget category.")
    if not body.reason.strip() or len(body.reason.strip()) < 3:
        raise HTTPException(422, "Give a reason for this funding assignment.")
    source = db.get(FundingSource, body.funding_source_id)
    if not source:
        raise HTTPException(404, "Funding source not found")
    if category.funding_source_id == source.id:
        return to_dict(category)
    if category.funding_source_id is not None:
        raise HTTPException(409, "This category already has a funding source. Refresh its configuration; existing programme assignments cannot be overwritten here.")
    if db.query(PaymentClaim.id).filter(
        PaymentClaim.category_id == category.id, PaymentClaim.status != "CANCELLED",
    ).first():
        raise HTTPException(409, "This category already has live claims. Central Finance must configure a separate category rather than reclassify them.")
    category.funding_source_id = source.id
    audit.record(db, current, "claim_category", category.id, "assign_initial_funding",
                 before={"funding_source_id": None},
                 after={"funding_source_id": source.id, "funding_source_name": source.name},
                 reason=body.reason.strip())
    db.commit()
    return to_dict(category)


def _visible(db, current):
    return db.query(WorkLog).filter(
        WorkLog.period_id.in_(db.query(PayPeriod.id).filter(PayPeriod.status != "ARCHIVED")),
        WorkLog.workflow_version >= 2,
        record_condition(current, WorkLog.assignment_id, WorkLog.cadre_id),
        WorkLog.staff_id != current.staff_id,
    )


def _log(db, current, log_id, lock=False):
    query = _visible(db, current).filter(WorkLog.id == log_id)
    if lock:
        query = query.with_for_update()
    log = query.first()
    if not log:
        raise HTTPException(404, "Work log not found in your Regional Finance scope")
    return log


def _payors(db, log):
    try:
        return {"eligible_payors": [{"id": owner.id, "name": owner.name, "type": owner.type}
                                   for owner in finance_gate.eligible_payors(db, log)], "routing_exception": None}
    except HTTPException as error:
        if error.status_code != 422:
            raise
        return {"eligible_payors": [], "routing_exception": error.detail}


@router.get("/monthly-summary")
def monthly_summary(
    month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    region_id: Optional[int] = Query(default=None, gt=0),
    work_type: Literal["SERVICES", "PAYROLL"] = "PAYROLL",
    db: Session = Depends(get_db),
    current=Depends(require_roles(REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE)),
):
    # Do not let the legacy endpoint bypass Regional Finance publication.
    if monthly_reports.cso_only(current):
        return monthly_reports.view(db, current, month, region_id, work_type)["report"]
    from ...services.finance_reports import monthly_summary as report
    return report(db, current, month, region_id, work_type)


@router.get("/regions")
def regions(db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE))):
    query = db.query(Region)
    if not current.unrestricted:
        allowed = monthly_reports.cso_regions(db, current) if monthly_reports.cso_only(current) else regions_for(current)
        query = query.filter(Region.id.in_(allowed))
    return [{"id": region.id, "name": region.name} for region in query.order_by(Region.name)]


@router.get("/payors")
def payors(work_log_id: int = Query(gt=0), db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    log = _log(db, current, work_log_id)
    return {"work_log_id": log.id, **_payors(db, log)}


@router.get("/central-reviewers")
def central_reviewers(work_log_id: int = Query(gt=0), db: Session = Depends(get_db),
                      current=Depends(require_roles(REGIONAL_FINANCE))):
    from ...services.central_review import eligible_reviewers
    log = _log(db, current, work_log_id)
    if log.work_type != "SERVICES":
        raise HTTPException(409, "Central Finance assignment is for Services only.")
    return [{"id": user.id, "name": user.full_name, "username": user.username}
            for user in eligible_reviewers(db, log) if user.id != current.id]


def _next_action(log: WorkLog, review_required: bool, snapshot: dict) -> str:
    if review_required and not log.finance_timesheet_approved_at:
        return "REVIEW_TIMESHEET"
    if review_required or snapshot.get("payment_policy") not in finance_gate.FIXED_DAILY_POLICIES:
        return "REVIEW_AMOUNT"
    return "CHANNEL"


@router.get("/pending-routing")
def pending_routing(
    region_id: Optional[int] = Query(default=None, gt=0),
    work_type: Optional[Literal["SERVICES", "PAYROLL"]] = None,
    stage: Optional[Literal["PENDING_FINANCE_REVIEW", "FINANCE_REVIEWED", "BUDGET_HOLD"]] = None,
    db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE)),
):
    query = _visible(db, current).filter(WorkLog.work_type == "SERVICES", WorkLog.status.in_([wf.PENDING_FINANCE, wf.FINANCE_REVIEWED, wf.BUDGET_HOLD]))
    if stage:
        query = query.filter(WorkLog.status == stage)
    if region_id:
        query = query.filter(WorkLog.assignment_id.in_(db.query(StaffAssignment.id).filter(StaffAssignment.region_id == region_id)))
    if work_type:
        query = query.filter(WorkLog.work_type == work_type)
    rows = []
    for log in query.order_by(WorkLog.status_changed_at, WorkLog.id):
        assignment = db.get(StaffAssignment, log.assignment_id)
        staff, cadre = db.get(Staff, log.staff_id), db.get(Cadre, log.cadre_id)
        facility = db.get(Facility, assignment.facility_id) if assignment.facility_id else None
        region, period = db.get(Region, assignment.region_id), db.get(PayPeriod, log.period_id)
        claim = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != "CANCELLED").first()
        snapshot = log.finance_snapshot or {}
        amount = claim.amount if claim else snapshot.get("total")
        currency = claim.currency if claim else snapshot.get("currency")
        review_required = log.status == wf.PENDING_FINANCE
        rows.append({
            "work_log_id": log.id, "claim_id": claim.id if claim else None,
            "workflow_version": log.workflow_version, "work_type": log.work_type,
            "provider_name": staff.legal_name, "cadre_id": cadre.id, "cadre_code": cadre.code, "cadre_name": cadre.name,
            "facility_id": facility.id if facility else None, "facility_name": facility.name if facility else None,
            "region_id": region.id, "region_name": region.name, "period_label": wf.period_label(period),
            "status": log.status, "amount": str(amount) if amount is not None else None, "currency": currency,
            "finance_review_required": review_required,
            "next_action": _next_action(log, review_required, snapshot),
            **_payors(db, log),
        })
    return rows


@router.post("/channel")
def channel(body: ChannelIn, db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    log_id = body.work_log_id
    if body.claim_id:
        claim = db.query(PaymentClaim).filter(PaymentClaim.id == body.claim_id, PaymentClaim.workflow_version >= 2,
                                             PaymentClaim.status != "CANCELLED").first()
        if not claim or not claim.work_log_id:
            raise HTTPException(404, "Claim not found")
        # Check the linked log's scope before revealing any identity mismatch.
        _log(db, current, claim.work_log_id)
        if log_id and log_id != claim.work_log_id:
            raise HTTPException(422, "Claim and work log do not refer to the same record")
        log_id = claim.work_log_id
    if not log_id:
        raise HTTPException(422, "Provide claim_id or work_log_id")
    log = _log(db, current, log_id, lock=True)
    if log.work_type == "PAYROLL":
        raise HTTPException(409, "Payroll is report-only; no finance approval or payment channel is required.")
    if log.status not in {wf.FINANCE_REVIEWED, wf.BUDGET_HOLD} or not log.finance_snapshot:
        raise HTTPException(409, "The amount must be reviewed by Regional Finance before channeling")
    action = "release" if log.status == wf.BUDGET_HOLD else ("route_fhi360" if log.work_type == "SERVICES" else "route_cso")
    if not body.review_confirmed or body.review_type != log.work_type:
        raise HTTPException(422, "Confirm review of the correct Services or Payroll log before channeling")
    if body.target_payor_id not in {owner.id for owner in finance_gate.eligible_payors(db, log)}:
        raise HTTPException(422, "The selected payor does not match this provider's assigned payment channel")
    wf.transition(db, current, log, action, body.comment,
                  {"target_payor_id": body.target_payor_id, "review_confirmed": True, "review_type": body.review_type,
                   "central_reviewer_id": body.central_reviewer_id,
                   "expected_review_token": body.expected_review_token},
                  body.expected_version)
    claim = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != "CANCELLED").one()
    owner = finance_gate.eligible_payors(db, log)[0]
    result = {
        "work_log_id": log.id, "claim_id": claim.id, "status": log.status, "claim_status": claim.status,
        "payor_id": owner.id, "payor_name": owner.name, "channel": log.finance_snapshot["channel"],
        "amount": str(claim.amount), "currency": claim.currency,
    }
    audit.record(db, current, "payment_claim", claim.id, "finance_channel", after=result, reason=body.comment)
    db.commit()
    return result


# ---- Services: send a region's whole month to FHI360 Central Finance at once --------------------------------------

def _services_month_logs(db, current, month, region_id):
    from ...core.period_dates import pay_month_range
    from ...models import WorkLogEntry
    monthly_reports.check_month(month)
    if not current.unrestricted and region_id not in regions_for(current):
        raise HTTPException(403, "This region is outside your Regional Finance scope.")
    start, end = pay_month_range(month)
    return (_visible(db, current).filter(
        WorkLog.work_type == "SERVICES",
        WorkLog.assignment_id.in_(db.query(StaffAssignment.id).filter(StaffAssignment.region_id == region_id)),
        WorkLog.id.in_(db.query(WorkLogEntry.work_log_id).filter(WorkLogEntry.entry_date.between(start, end))))
        .order_by(WorkLog.id))


def _amount(db, log):
    claim = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != "CANCELLED").first()
    value = claim.amount if claim else (log.finance_snapshot or {}).get("total")
    return str(value) if value is not None else None


@router.get("/services-month")
def services_month(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), region_id: int = Query(gt=0),
                   db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    """Where a region's Services for the month stand: still to check, checked and ready to send, sent."""
    from decimal import Decimal
    from ...services.central_review import eligible_reviewers
    logs = _services_month_logs(db, current, month, region_id).all()
    stages = {"review": [wf.PENDING_FINANCE], "ready": [wf.FINANCE_REVIEWED], "hold": [wf.BUDGET_HOLD],
              "sent": [wf.ROUTED_FHI360, wf.PAID]}
    counts = {stage: sum(1 for log in logs if log.status in statuses) for stage, statuses in stages.items()}
    ready = [log for log in logs if log.status == wf.FINANCE_REVIEWED]
    total = sum((Decimal(a) for a in (_amount(db, log) for log in ready) if a is not None), Decimal(0))
    reviewers = []
    if ready:
        # Only a reviewer who may approve every one of them can take the month.
        allowed = None
        for log in ready:
            ids = {user.id: user for user in eligible_reviewers(db, log) if user.id != current.id}
            allowed = ids if allowed is None else {k: v for k, v in allowed.items() if k in ids}
        reviewers = [{"id": u.id, "name": u.full_name, "username": u.username} for u in (allowed or {}).values()]
    return {"month": month, "region_id": region_id, "counts": counts, "ready_total": str(total), "currency": "TZS",
            "ready": [{"work_log_id": log.id, "provider_name": db.get(Staff, log.staff_id).legal_name, "amount": _amount(db, log)}
                      for log in ready],
            "central_reviewers": reviewers}


class ServicesMonthIn(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    region_id: int = Field(gt=0)
    central_reviewer_id: int = Field(gt=0)
    review_confirmed: bool
    comment: Optional[str] = Field(default=None, max_length=2000)


@router.post("/services-month/send")
def send_services_month(body: ServicesMonthIn, db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    """Send every checked Services timesheet of the region and month to Central Finance in one step. All or none: if
    one cannot go, nothing is sent and the message names the person."""
    if not body.review_confirmed:
        raise HTTPException(422, "Confirm that you checked the month's Services before sending them.")
    logs = _services_month_logs(db, current, body.month, body.region_id).filter(WorkLog.status == wf.FINANCE_REVIEWED).with_for_update().all()
    if not logs:
        raise HTTPException(409, "No checked Services are ready to send for this region and month.")
    sent = []
    for log in logs:
        name = db.get(Staff, log.staff_id).legal_name
        try:
            payor = finance_gate.eligible_payors(db, log)[0]
            wf.transition(db, current, log, "route_fhi360", body.comment or f"Sent with {body.month} Services to Central Finance",
                          {"target_payor_id": payor.id, "review_confirmed": True, "review_type": "SERVICES",
                           "central_reviewer_id": body.central_reviewer_id,
                           "expected_review_token": (log.finance_snapshot or {}).get("review_token")},
                          log.version)
        except HTTPException as error:
            db.rollback()
            raise HTTPException(error.status_code, f"{name}: {error.detail} Nothing was sent.")
        claim = db.query(PaymentClaim).filter(PaymentClaim.work_log_id == log.id, PaymentClaim.status != "CANCELLED").one()
        sent.append({"work_log_id": log.id, "claim_id": claim.id, "provider_name": name, "amount": str(claim.amount)})
    audit.record(db, current, "services_month", f"{body.month}:{body.region_id}", "send_to_central_finance",
                 after={"count": len(sent), "central_reviewer_id": body.central_reviewer_id, "claims": [s["claim_id"] for s in sent]})
    db.commit()
    return {"sent": sent, "count": len(sent)}



# ---- Regional Finance: approve timesheets in bulk (clean ones; flagged ones one by one) -----------------------------

@router.get("/bulk-review")
def bulk_review(work_type: Literal["SERVICES", "PAYROLL"], month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
                region_id: int = Query(gt=0), cadre_id: Optional[int] = Query(default=None, gt=0),
                facility_id: Optional[int] = Query(default=None, gt=0),
                db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    """Timesheets of a region's month waiting for Regional Finance, each marked clean or with the reasons to look at it."""
    from ...services import finance_bulk
    monthly_reports.check_month(month)
    return finance_bulk.review_list(db, current, work_type, month, region_id, cadre_id, facility_id)


class BulkApproveIn(BaseModel):
    work_type: Literal["SERVICES", "PAYROLL"]
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    region_id: int = Field(gt=0)
    work_log_ids: list[int] = Field(min_length=1)
    funding_source_id: Optional[int] = Field(default=None, gt=0)
    review_confirmed: bool


@router.post("/bulk-approve")
def bulk_approve(body: BulkApproveIn, db: Session = Depends(get_db), current=Depends(require_roles(REGIONAL_FINANCE))):
    """Approve the clean timesheets chosen. Services: timesheet and amount together, with one funding source. Payroll:
    the timesheet, ready for the region's sign-off. Nothing is sent here."""
    from ...services import finance_bulk
    if not body.review_confirmed:
        raise HTTPException(422, "Confirm that you checked these timesheets before approving them.")
    result = finance_bulk.approve(db, current, body.work_type, body.month, body.region_id, body.work_log_ids, body.funding_source_id)
    audit.record(db, current, "bulk_approval", f"{body.work_type}:{body.month}:{body.region_id}", "approve",
                 after={"approved": len(result["approved"]), "skipped": len(result["skipped"]), "funding_source_id": body.funding_source_id})
    db.commit()
    return result
