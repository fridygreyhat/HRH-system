"""CSO Finance records the salary payments it made for a signed Payroll month.

The CSO pays outside the app (bank or mobile wallet). Recording each payment, with the bank reference and the bank
schedule as proof, is what lets Central Finance reconcile what was signed against what was paid."""
import json
import os
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, UploadFile
from sqlalchemy import func

from ..core import audit
from ..core.settings import get_setting
from ..core.timeutil import local_today
from ..models import PayrollPayment, Staff, User, utcnow
from . import monthly_report_approval as reports
from . import payments
from .salary_timesheets import OTHER_ROW, signed

MAX_ROWS = 2000
CENT = Decimal("0.01")


def paid_by_staff(db, month: str, staff_ids=None) -> dict[int, Decimal]:
    """Salary paid so far this month to each provider, by any CSO (voided and failed payments do not count)."""
    query = db.query(PayrollPayment.staff_id, func.sum(PayrollPayment.amount)).filter(
        PayrollPayment.month == month, PayrollPayment.status == "PAID", PayrollPayment.voided_at.is_(None))
    if staff_ids is not None:
        query = query.filter(PayrollPayment.staff_id.in_(staff_ids or [-1]))
    return {staff_id: total for staff_id, total in query.group_by(PayrollPayment.staff_id)}


def due(db, current, org, month: str) -> dict[int, dict]:
    """Each provider on the CSO's signed salary file this month: signed salary, paid so far, and what is still due."""
    result = signed(db, current, org, month)
    region_ids = {region["name"]: region["id"] for region in result["regions"]}
    paid = paid_by_staff(db, month, [p["staff_id"] for p in result["providers"]])
    rows = {}
    for provider in result["providers"]:
        if OTHER_ROW in provider["checks"] or provider["monthly_salary"] is None:
            continue  # a second placement row, or no salary to pay
        expected = Decimal(provider["monthly_salary"])
        already = paid.get(provider["staff_id"], Decimal(0))
        rows[provider["staff_id"]] = {
            "staff_id": provider["staff_id"], "provider_name": provider["provider_name"], "cadre_name": provider["cadre_name"],
            "region_id": region_ids[provider["region_name"]], "region_name": provider["region_name"],
            "expected": expected, "paid": already, "outstanding": max(expected - already, Decimal(0)),
            "pay_components": provider.get("pay_components"),
        }
    return rows


def _items(items_json: str) -> list[dict]:
    try:
        items = json.loads(items_json)
    except (TypeError, ValueError):
        raise HTTPException(422, "Choose the providers paid, then try again.")
    if not isinstance(items, list) or not items:
        raise HTTPException(422, "Choose at least one provider paid.")
    if len(items) > MAX_ROWS:
        raise HTTPException(422, f"Record at most {MAX_ROWS:,} payments at once.")
    parsed, seen = [], set()
    for item in items:
        staff_id = item.get("staff_id") if isinstance(item, dict) else None
        if not isinstance(staff_id, int) or isinstance(staff_id, bool) or staff_id in seen:
            raise HTTPException(422, "Each provider is listed once.")
        seen.add(staff_id)
        amount = item.get("amount")
        if amount not in (None, ""):
            try:
                amount = Decimal(str(amount))
            except InvalidOperation:
                raise HTTPException(422, "Amounts are numbers in shillings, e.g. 150000.")
            if not amount.is_finite() or amount != amount.quantize(CENT) or amount < 0 or amount >= Decimal("1e13"):
                raise HTTPException(422, "Amounts are numbers in shillings and cents, zero or more.")
        else:
            amount = None
        parsed.append({"staff_id": staff_id, "amount": amount})
    return parsed


def record(db, current, org, month: str, items_json: str, payment_date: date, reference: str, method: str, status: str,
           upload: UploadFile | None) -> list[PayrollPayment]:
    """Record one bank transfer or schedule (one reference) paying one or more providers. Does not commit."""
    reports.check_month(month)
    reference = (reference or "").strip()
    if not 1 <= len(reference) <= 200:
        raise HTTPException(422, "Enter the payment reference from the bank or mobile money statement.")
    if method not in ("BANK", "MOBILE_WALLET"):
        raise HTTPException(422, "Payment method must be BANK or MOBILE_WALLET.")
    if status not in ("PAID", "FAILED"):
        raise HTTPException(422, "Status must be PAID or FAILED.")
    if payment_date > local_today():
        raise HTTPException(422, "The payment date cannot be in the future.")
    items = _items(items_json)
    if status == "PAID" and upload is None and get_setting(db, "payment_requires_proof"):
        raise HTTPException(422, "Upload the bank schedule or receipt that shows these payments.")
    # Lock the providers, so two people recording at once cannot both pay the same salary.
    db.query(Staff.id).filter(Staff.id.in_([item["staff_id"] for item in items])).order_by(Staff.id).with_for_update().all()
    rows = due(db, current, org, month)
    report_ids = {}
    planned = []
    for item in items:
        row = rows.get(item["staff_id"])
        if row is None:
            name = (db.get(Staff, item["staff_id"]).legal_name if db.get(Staff, item["staff_id"]) else f"Staff {item['staff_id']}")
            raise HTTPException(422, f"{name} is not on your signed salary file for {month}, so no salary payment can be recorded.")
        amount = item["amount"] if item["amount"] is not None else (row["outstanding"] if status == "PAID" else row["expected"])
        if status == "PAID":
            if row["outstanding"] <= 0:
                raise HTTPException(409, f"{row['provider_name']}'s salary for {month} is already recorded as paid in full.")
            if amount <= 0:
                raise HTTPException(422, f"Enter the amount paid to {row['provider_name']}.")
            if amount > row["outstanding"]:
                raise HTTPException(422, f"{row['provider_name']}: {amount:,.2f} is more than the {row['outstanding']:,.2f} still due "
                                         f"on the signed salary. Check the amount; the system does not record an overpayment.")
            if db.query(PayrollPayment.id).filter(
                    PayrollPayment.staff_id == row["staff_id"], PayrollPayment.month == month,
                    PayrollPayment.payment_reference == reference, PayrollPayment.status == "PAID",
                    PayrollPayment.voided_at.is_(None)).first():
                raise HTTPException(409, f"Reference {reference} is already recorded for {row['provider_name']} this month. "
                                         "Recording it again would count the payment twice.")
        if row["region_id"] not in report_ids:
            report_ids[row["region_id"]] = reports.latest(db, month, row["region_id"], "PAYROLL").id
        planned.append((row, amount))
    stored = payments.save_proof_file(upload) if upload is not None else None
    try:
        created = []
        for row, amount in planned:
            payment = PayrollPayment(
                month=month, region_id=row["region_id"], organization_id=org.id, staff_id=row["staff_id"],
                report_id=report_ids[row["region_id"]], expected_amount=row["expected"], amount=amount, currency="TZS",
                status=status, payment_date=payment_date, payment_reference=reference, payment_method=method,
                pay_components=row["pay_components"], recorded_by=current.id,
                **({"proof_key": stored["storage_key"], "proof_filename": stored["original_filename"],
                    "proof_content_type": stored["content_type"], "proof_size_bytes": stored["size_bytes"],
                    "proof_sha256": stored["sha256"]} if stored else {}))
            db.add(payment)
            created.append(payment)
        db.flush()
        audit.record(db, current, "organization", org.id, "record_salary_payments", after={
            "month": month, "reference": reference, "status": status, "payment_date": str(payment_date),
            "payment_method": method, "payments": {str(p.staff_id): str(p.amount) for p in created},
            "total": str(sum((p.amount for p in created), Decimal(0))), "proof_sha256": stored["sha256"] if stored else None})
    except Exception:
        if stored:
            remove_file(stored["storage_key"])
        raise
    return created


def remove_file(key: str) -> None:
    try:
        path = os.path.join(payments.config.UPLOAD_DIR, key)
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def void(db, current, org, payment_id: int, reason: str) -> PayrollPayment:
    """A mistaken entry is voided, not deleted: the record and who voided it stay for the audit. Does not commit."""
    reason = (reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(422, "Say why this payment record is wrong (at least 5 characters).")
    payment = db.query(PayrollPayment).filter_by(id=payment_id, organization_id=org.id).with_for_update().first()
    if payment is None:
        raise HTTPException(404, "Salary payment not found")
    if payment.voided_at is not None:
        raise HTTPException(409, "This salary payment is already voided.")
    payment.voided_at, payment.voided_by, payment.void_reason = utcnow(), current.id, reason[:1000]
    db.flush()
    audit.record(db, current, "payroll_payment", payment.id, "void", reason=reason,
                 after={"month": payment.month, "staff_id": payment.staff_id, "amount": str(payment.amount),
                        "reference": payment.payment_reference})
    return payment


def payment_out(db, payment: PayrollPayment, names: dict | None = None) -> dict:
    names = names if names is not None else {}
    staff = names.get(payment.staff_id) or db.get(Staff, payment.staff_id).legal_name
    recorder = db.get(User, payment.recorded_by)
    return {
        "id": payment.id, "month": payment.month, "staff_id": payment.staff_id, "provider_name": staff,
        "region_id": payment.region_id, "organization_id": payment.organization_id,
        "expected_amount": str(payment.expected_amount) if payment.expected_amount is not None else None,
        "amount": str(payment.amount), "currency": payment.currency, "status": payment.status,
        "payment_date": str(payment.payment_date), "payment_reference": payment.payment_reference,
        "payment_method": payment.payment_method, "pay_components": payment.pay_components,
        "has_proof": bool(payment.proof_key), "proof_filename": payment.proof_filename,
        "recorded_by_name": recorder.full_name if recorder else None, "recorded_at": payment.created_at.isoformat(),
        "voided": payment.voided_at is not None, "void_reason": payment.void_reason,
    }


def listing(db, org, month: str) -> list[dict]:
    rows = db.query(PayrollPayment).filter_by(organization_id=org.id, month=month).order_by(PayrollPayment.id.desc()).all()
    names = {s.id: s.legal_name for s in db.query(Staff).filter(Staff.id.in_({r.staff_id for r in rows} or {-1}))}
    return [payment_out(db, row, names) for row in rows]


def proof_path(payment: PayrollPayment) -> str:
    if not payment.proof_key:
        raise HTTPException(404, "No proof file was uploaded with this payment.")
    path = os.path.join(payments.config.UPLOAD_DIR, payment.proof_key)
    if not os.path.isfile(path):
        raise HTTPException(404, "The proof file is missing from storage.")
    return path
