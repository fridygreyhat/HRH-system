"""Monthly financial audit and reconciliation.

For one pay month, by region and cadre: what was approved to be paid against what was recorded as paid.
- Payroll: each provider's salary on Regional Finance's signed report, against the salary payments the CSO recorded.
- Services: each approved Services claim, against the payments recorded on it (FHI360 Central Finance).
Every difference is listed as an issue to follow up. Reading it never pays anyone or changes a record."""
import csv
import hashlib
import io
import json
from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException
from openpyxl import Workbook
from openpyxl.styles import Font

from ..core.period_dates import pay_month_range
from ..core.roles import FHI360_FINANCE, OVERSIGHT, REGIONAL_FINANCE
from ..core.serialize import spreadsheet_safe
from ..models import (Cadre, ClaimCategory, FinanceMonthlyReport, FinanceReconciliation, FundingSource, MonthlyServiceBudget,
                      PaymentClaim, PaymentProof, PaymentRecord, PayPeriod, PayrollPayment, Region, Staff, StaffAssignment, User,
                      WorkLog)
from . import claims as cl
from . import monthly_report_approval as reports
from .salary_amounts import amounts_for, components_for
from .salary_timesheets import OTHER_ROW, with_payment
from .v22_scope import regions_for

ZERO = Decimal(0)
APPROVED_TO_PAY = cl.COMMITTED_STATUSES  # APPROVED, READY, EXPORTED, HANDED_OFF
# Status of each provider's money for the month, and what an auditor should do about it.
STATUS_TEXT = {
    "PAID": "Paid in full",
    "NOT_PAID": "Approved, not yet paid",
    "PART_PAID": "Part paid",
    "OVERPAID": "Paid more than approved",
    "PAID_NOT_SIGNED": "Paid, but not on the signed Payroll report",
    "SALARY_MISSING": "Signed, but no salary amount is set",
    "IN_REVIEW": "Still in review: not yet approved to pay",
    "PAID_BEFORE_APPROVAL": "Paid before the claim was approved",
    "PAID_CANCELLED": "Paid on a cancelled claim",
}
ISSUE_TEXT = {
    **{key: STATUS_TEXT[key] for key in ("NOT_PAID", "PART_PAID", "OVERPAID", "PAID_NOT_SIGNED", "SALARY_MISSING",
                                         "PAID_BEFORE_APPROVAL", "PAID_CANCELLED")},
    "NO_PROOF": "Payment recorded without proof of payment",
    "FAILED_PAYMENT": "A payment failed and the money is still due",
    "NO_CSO": "Signed, but no CSO is set on the placement to pay the salary",
    "PAYROLL_NOT_SIGNED": "Payroll report not signed by Regional Finance",
    "PAYROLL_TAKEN_BACK": "Payroll sign-off taken back; Regional Finance must sign again",
}
VIEWERS = (FHI360_FINANCE, OVERSIGHT, REGIONAL_FINANCE)


def region_scope(current) -> set[int] | None:
    """None: every region (Central Finance, Oversight). Regional Finance sees only its own regions."""
    if current.unrestricted or current.has_any(FHI360_FINANCE, OVERSIGHT):
        return None
    if current.has_any(REGIONAL_FINANCE):
        return regions_for(current)
    raise HTTPException(403, "Only Central Finance, Oversight and Regional Finance see the reconciliation.")


def can_sign(current) -> bool:
    return current.unrestricted or current.has_any(FHI360_FINANCE)


def _money(value) -> str | None:
    return None if value is None else str(Decimal(value).quantize(Decimal("0.01")))


def _status(expected, paid):
    if expected is None:
        return "SALARY_MISSING"
    if paid == 0:
        return "NOT_PAID"
    if paid < expected:
        return "PART_PAID"
    return "PAID" if paid == expected else "OVERPAID"


def _payroll(db, month, regions, cadre_names):
    """Signed salary per provider (one salary, however many placement rows), against recorded salary payments."""
    rows, region_issues = [], []
    for region in regions:
        latest = reports.latest(db, month, region.id, "PAYROLL")
        if latest is None:
            ever = db.query(FinanceMonthlyReport.id).filter_by(month=month, region_id=region.id, work_type="PAYROLL").first()
            region_issues.append({"region_id": region.id, "region_name": region.name,
                                  "issue": "PAYROLL_TAKEN_BACK" if ever else "PAYROLL_NOT_SIGNED"})
            continue
        placed = set()
        for org_id, report in latest.snapshot["organizations"].items():
            for provider in report["providers"]:
                rows.append({**provider, "organization_id": int(org_id), "region_id": region.id, "report_id": latest.id})
                placed.add(provider["staff_id"])
        for provider in latest.snapshot["regional"]["providers"]:
            if provider["staff_id"] not in placed:
                rows.append({**provider, "organization_id": None, "region_id": region.id, "report_id": latest.id, "no_cso": True})
    people = {s.id: s for s in db.query(Staff).filter(Staff.id.in_({r["staff_id"] for r in rows} or {-1}))}
    with_payment(rows, people, amounts_for(db, month), components_for(db, month))
    signed = {}
    for row in rows:
        entry = signed.setdefault(row["staff_id"], {
            "staff_id": row["staff_id"], "provider_name": row["provider_name"], "cadre_code": row["cadre_code"],
            "cadre_name": row["cadre_name"], "region_id": row["region_id"], "region_name": row["region_name"],
            "organization_id": row["organization_id"], "expected": None, "salary_missing": False, "no_cso": False})
        if row.get("no_cso"):
            entry["no_cso"] = True  # owed, but no CSO is set to pay it
        if OTHER_ROW not in row["checks"]:
            if row["monthly_salary"] is not None:
                entry["expected"] = (entry["expected"] or ZERO) + Decimal(row["monthly_salary"])
                entry.update(region_id=row["region_id"], region_name=row["region_name"], organization_id=row["organization_id"])
            elif row["days_signed"]:
                entry["salary_missing"] = True
    region_ids = [r.id for r in regions]
    payments = db.query(PayrollPayment).filter(PayrollPayment.month == month, PayrollPayment.region_id.in_(region_ids or [-1]),
                                               PayrollPayment.voided_at.is_(None)).order_by(PayrollPayment.id).all()
    paid = defaultdict(lambda: {"paid": ZERO, "failed": 0, "references": [], "no_proof": False, "region_id": None})
    for payment in payments:
        item = paid[payment.staff_id]
        item["region_id"] = item["region_id"] or payment.region_id
        if payment.status == "PAID":
            item["paid"] += payment.amount
            item["references"].append(payment.payment_reference)
            item["no_proof"] = item["no_proof"] or not payment.proof_key
        else:
            item["failed"] += 1
    extra = set(paid) - set(signed)
    names = {r.id: r.name for r in regions}
    for staff in db.query(Staff).filter(Staff.id.in_(extra or {-1})):
        signed[staff.id] = {"staff_id": staff.id, "provider_name": staff.legal_name, "cadre_code": cadre_names[staff.cadre_id][0],
                            "cadre_name": cadre_names[staff.cadre_id][1], "region_id": paid[staff.id]["region_id"],
                            "region_name": names.get(paid[staff.id]["region_id"]), "organization_id": None,
                            "expected": None, "salary_missing": False, "no_cso": False, "not_signed": True}
    detail = []
    for staff_id, entry in signed.items():
        item = paid.get(staff_id) or {"paid": ZERO, "failed": 0, "references": [], "no_proof": False}
        if entry.get("not_signed") or (entry["expected"] is None and not entry["salary_missing"]):
            # Not on the signed report, or listed without a salary because the provider did not sign: nothing is owed.
            status = "PAID_NOT_SIGNED" if item["paid"] > 0 else None
        else:
            status = _status(entry["expected"], item["paid"])
        if status is None:
            continue  # a failed payment for someone not signed: nothing was owed or paid
        issues = [status] if status != "PAID" else []
        if entry["no_cso"]:
            issues.append("NO_CSO")
        if item["no_proof"]:
            issues.append("NO_PROOF")
        if item["failed"] and status in ("NOT_PAID", "PART_PAID"):
            issues.append("FAILED_PAYMENT")
        expected = entry["expected"]
        detail.append({
            "work_type": "PAYROLL", "staff_id": staff_id, "provider_name": entry["provider_name"],
            "cadre_code": entry["cadre_code"], "cadre_name": entry["cadre_name"], "region_id": entry["region_id"],
            "region_name": entry["region_name"], "claim_id": None, "claim_status": None,
            "expected": expected, "paid": item["paid"], "in_review": ZERO,
            "outstanding": max((expected or ZERO) - item["paid"], ZERO) if expected is not None else ZERO,
            "overpaid": max(item["paid"] - (expected or ZERO), ZERO),
            "status": status, "issues": issues, "references": item["references"], "funding_source": None})
    return detail, region_issues


def _services(db, month, regions, cadre_names):
    start, end = pay_month_range(month)
    region_ids = [r.id for r in regions]
    names = {r.id: r.name for r in regions}
    found = (db.query(PaymentClaim, StaffAssignment.region_id, Staff, WorkLog.cadre_id)
             .join(PayPeriod, PayPeriod.id == PaymentClaim.period_id)
             .join(Staff, Staff.id == PaymentClaim.staff_id)
             .join(StaffAssignment, StaffAssignment.id == PaymentClaim.assignment_id)
             .outerjoin(WorkLog, WorkLog.id == PaymentClaim.work_log_id)
             .filter(PaymentClaim.work_type == "SERVICES", PayPeriod.end_date.between(start, end),
                     StaffAssignment.region_id.in_(region_ids or [-1]))
             .order_by(PaymentClaim.id).all())
    claim_ids = [claim.id for claim, *_ in found]
    paid, failed = defaultdict(lambda: ZERO), defaultdict(int)
    references = defaultdict(list)
    for record in db.query(PaymentRecord).filter(PaymentRecord.claim_id.in_(claim_ids or [-1])):
        if record.status in ("PAID", "PARTIAL"):
            paid[record.claim_id] += record.amount
            references[record.claim_id].append(record.payment_reference)
        else:
            failed[record.claim_id] += 1
    proved = {row[0] for row in db.query(PaymentProof.claim_id).filter(PaymentProof.claim_id.in_(claim_ids or [-1])).distinct()}
    sources = {f.id: f.code for f in db.query(FundingSource)}
    category_source = {c.id: c.funding_source_id for c in db.query(ClaimCategory).filter(
        ClaimCategory.id.in_({claim.category_id for claim, *_ in found if claim.category_id} or {-1}))}
    detail = []
    for claim, region_id, staff, log_cadre in found:
        amount, money_paid = claim.amount, paid[claim.id]
        if claim.status == cl.CANCELLED:
            if money_paid <= 0:
                continue
            status, expected, in_review = "PAID_CANCELLED", ZERO, ZERO
        elif claim.status in APPROVED_TO_PAY:
            status, expected, in_review = _status(amount, money_paid), amount, ZERO
        else:
            status, expected, in_review = ("PAID_BEFORE_APPROVAL" if money_paid > 0 else "IN_REVIEW"), ZERO, amount
        issues = [status] if status not in ("PAID", "IN_REVIEW") else []
        if money_paid > 0 and claim.id not in proved:
            issues.append("NO_PROOF")
        if failed[claim.id] and status in ("NOT_PAID", "PART_PAID"):
            issues.append("FAILED_PAYMENT")
        code, name = cadre_names[log_cadre or staff.cadre_id]
        detail.append({
            "work_type": "SERVICES", "staff_id": staff.id, "provider_name": staff.legal_name, "cadre_code": code,
            "cadre_name": name, "region_id": region_id, "region_name": names.get(region_id), "claim_id": claim.id,
            "claim_status": claim.status, "expected": expected, "paid": money_paid, "in_review": in_review,
            "outstanding": max(expected - money_paid, ZERO), "overpaid": max(money_paid - expected, ZERO) if expected else money_paid,
            "status": status, "issues": issues, "references": references[claim.id],
            "funding_source": sources.get(claim.funding_source_id or category_source.get(claim.category_id))})
    return detail


def _summary(detail):
    groups = {}
    for row in detail:
        key = (row["work_type"], row["region_name"] or "", row["cadre_name"])
        group = groups.setdefault(key, {"work_type": row["work_type"], "region_id": row["region_id"], "region_name": row["region_name"],
                                        "cadre_code": row["cadre_code"], "cadre_name": row["cadre_name"], "_providers": set(),
                                        "expected": ZERO, "paid": ZERO, "outstanding": ZERO, "overpaid": ZERO, "in_review": ZERO,
                                        "issues": 0})
        group["_providers"].add(row["staff_id"])
        for field in ("paid", "outstanding", "overpaid", "in_review"):
            group[field] += row[field]
        group["expected"] += row["expected"] or ZERO
        group["issues"] += len(row["issues"])
    result = []
    for key in sorted(groups):
        group = groups[key]
        result.append({**{k: v for k, v in group.items() if not k.startswith("_")}, "providers": len(group["_providers"])})
    return result


def _totals(rows):
    total = {"providers": len({r["staff_id"] for r in rows}), "issues": sum(len(r["issues"]) for r in rows)}
    for field in ("expected", "paid", "outstanding", "overpaid", "in_review"):
        total[field] = sum(((r[field] or ZERO) for r in rows), ZERO)
    total["paid_in_full"] = sum(1 for r in rows if r["status"] == "PAID")
    return total


def _out(value):
    """Decimals as strings, for JSON and the digest."""
    if isinstance(value, Decimal):
        return _money(value)
    if isinstance(value, dict):
        return {k: _out(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_out(v) for v in value]
    return value


def build(db, current, month: str, region_id: int | None = None, cadre: str | None = None, work_type: str | None = None) -> dict:
    reports.check_month(month)
    scope = region_scope(current)
    if region_id is not None and scope is not None and region_id not in scope:
        raise HTTPException(403, "This region is outside your finance scope.")
    query = db.query(Region).order_by(Region.name)
    if region_id is not None:
        query = query.filter(Region.id == region_id)
    elif scope is not None:
        query = query.filter(Region.id.in_(scope or {-1}))
    regions = query.all()
    if region_id is not None and not regions:
        raise HTTPException(404, "Region not found")
    cadre_names = {c.id: (c.code, c.name) for c in db.query(Cadre)}
    detail, region_issues = [], []
    if work_type in (None, "PAYROLL"):
        payroll, region_issues = _payroll(db, month, regions, cadre_names)
        detail += payroll
    if work_type in (None, "SERVICES"):
        detail += _services(db, month, regions, cadre_names)
    if cadre:
        detail = [row for row in detail if row["cadre_code"] == cadre]
    # Only regions with something to reconcile, or a Payroll sign-off still missing, are worth a line.
    active = {row["region_id"] for row in detail}
    region_issues = [issue for issue in region_issues if issue["region_id"] in active or region_id is not None] \
        if work_type != "SERVICES" else []
    detail.sort(key=lambda r: (r["work_type"], r["region_name"] or "", r["cadre_name"], r["provider_name"], r["claim_id"] or 0))
    issues = [{"work_type": row["work_type"], "region_name": row["region_name"], "cadre_name": row["cadre_name"],
               "staff_id": row["staff_id"], "provider_name": row["provider_name"], "claim_id": row["claim_id"],
               "issue": issue, "text": ISSUE_TEXT[issue],
               "amount": row["outstanding"] if issue in ("NOT_PAID", "PART_PAID", "FAILED_PAYMENT")
               else row["overpaid"] if issue in ("OVERPAID", "PAID_NOT_SIGNED", "PAID_CANCELLED", "PAID_BEFORE_APPROVAL")
               else row["paid"] if issue == "NO_PROOF" else row["expected"]}
              for row in detail for issue in row["issues"]]
    issues += [{"work_type": "PAYROLL", "region_name": item["region_name"], "cadre_name": None, "staff_id": None,
                "provider_name": None, "claim_id": None, "issue": item["issue"], "text": ISSUE_TEXT[item["issue"]], "amount": None}
               for item in region_issues]
    totals = {"PAYROLL": _totals([r for r in detail if r["work_type"] == "PAYROLL"]),
              "SERVICES": _totals([r for r in detail if r["work_type"] == "SERVICES"]), "all": _totals(detail)}
    totals["all"]["issues"] = len(issues)
    result = _out({"month": month, "region_id": region_id, "cadre": cadre, "work_type": work_type,
                   "totals": totals, "summary": _summary(detail), "issues": issues,
                   "providers": [{**row, "status_text": STATUS_TEXT[row["status"]]} for row in detail]})
    result["digest"] = hashlib.sha256(json.dumps({k: result[k] for k in ("month", "region_id", "totals", "providers", "issues")},
                                                 sort_keys=True, default=str).encode()).hexdigest()
    result["signoff"] = signoff(db, month, region_id, result["digest"])
    visible = db.query(Region).order_by(Region.name)
    if scope is not None:
        visible = visible.filter(Region.id.in_(scope or {-1}))
    result["regions"] = [{"id": r.id, "name": r.name} for r in visible]
    result["can_sign"] = can_sign(current) and not cadre and not work_type
    return result


def signoff(db, month, region_id, digest):
    row = (db.query(FinanceReconciliation).filter(FinanceReconciliation.month == month,
                                                 FinanceReconciliation.region_id.is_(None) if region_id is None
                                                 else FinanceReconciliation.region_id == region_id)
           .order_by(FinanceReconciliation.id.desc()).first())
    if row is None:
        return None
    signer = db.get(User, row.signed_by)
    return {"id": row.id, "signed_by_name": signer.full_name if signer else None, "signed_at": row.signed_at.isoformat(),
            "note": row.note, "issue_count": row.issue_count, "totals": row.totals, "current": row.digest == digest}


def sign(db, current, month: str, region_id: int | None, expected_digest: str, note: str | None) -> FinanceReconciliation:
    """Central Finance confirms the month reconciles (or explains what is still open). Does not commit."""
    if not can_sign(current):
        raise HTTPException(403, "Only Central Finance signs a reconciliation.")
    result = build(db, current, month, region_id)
    if result["digest"] != expected_digest:
        raise HTTPException(409, "The figures changed since you opened the reconciliation. Refresh and check them again.")
    note = (note or "").strip() or None
    if result["issues"] and (not note or len(note) < 10):
        raise HTTPException(422, "There are open issues: explain in the note how each will be followed up (at least 10 characters).")
    row = FinanceReconciliation(month=month, region_id=region_id, digest=result["digest"], totals=result["totals"],
                                issue_count=len(result["issues"]), note=note, signed_by=current.id)
    db.add(row)
    db.flush()
    from ..core import audit
    audit.record(db, current, "finance_reconciliation", row.id, "sign", reason=note,
                 after={"month": month, "region_id": region_id, "issues": len(result["issues"]), "totals": result["totals"]})
    return row


# ---- Files ------------------------------------------------------------------------------------------------------

SUMMARY_COLUMNS = ["Month", "Work type", "Region", "Cadre", "Providers", "Approved to pay (TZS)", "Paid (TZS)",
                   "Still to pay (TZS)", "Paid over approved (TZS)", "In review (TZS)", "Issues"]
PROVIDER_COLUMNS = ["Month", "Work type", "Region", "Cadre", "Staff ID", "Provider", "Claim ID", "Claim status",
                    "Approved to pay (TZS)", "Paid (TZS)", "Still to pay (TZS)", "Paid over approved (TZS)", "In review (TZS)",
                    "Status", "Issues", "Payment references"]
ISSUE_COLUMNS = ["Month", "Work type", "Region", "Cadre", "Staff ID", "Provider", "Claim ID", "Issue", "Amount (TZS)"]
WORK_TYPE_TEXT = {"PAYROLL": "Payroll", "SERVICES": "Services"}


def _number(value):
    return float(value) if value not in (None, "") else None


def sheets(result):
    month = result["month"]
    yield "Summary", SUMMARY_COLUMNS, [
        [month, WORK_TYPE_TEXT[g["work_type"]], g["region_name"], g["cadre_name"], g["providers"], _number(g["expected"]),
         _number(g["paid"]), _number(g["outstanding"]), _number(g["overpaid"]), _number(g["in_review"]), g["issues"]]
        for g in result["summary"]]
    yield "Providers", PROVIDER_COLUMNS, [
        [month, WORK_TYPE_TEXT[r["work_type"]], r["region_name"], r["cadre_name"], r["staff_id"], r["provider_name"], r["claim_id"],
         r["claim_status"], _number(r["expected"]), _number(r["paid"]), _number(r["outstanding"]), _number(r["overpaid"]),
         _number(r["in_review"]), r["status_text"], "; ".join(ISSUE_TEXT[i] for i in r["issues"]), "; ".join(r["references"])]
        for r in result["providers"]]
    yield "Issues", ISSUE_COLUMNS, [
        [month, WORK_TYPE_TEXT[i["work_type"]], i["region_name"], i["cadre_name"], i["staff_id"], i["provider_name"], i["claim_id"],
         i["text"], _number(i["amount"])]
        for i in result["issues"]]


def xlsx_file(result) -> bytes:
    book = Workbook()
    book.remove(book.active)
    for title, columns, rows in sheets(result):
        sheet = book.create_sheet(title)
        sheet.append(columns)
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for row in rows:
            sheet.append([spreadsheet_safe(value) for value in row])
        for index, column in enumerate(columns, start=1):
            sheet.column_dimensions[sheet.cell(1, index).column_letter].width = max(10, min(len(column) + 4, 40))
        sheet.freeze_panes = "A2"
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def csv_file(result) -> bytes:
    """The provider list: one row per provider and work type (one per claim for Services)."""
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    for title, columns, rows in sheets(result):
        if title != "Providers":
            continue
        writer.writerow(columns)
        for row in rows:
            writer.writerow(["" if value is None else spreadsheet_safe(value) for value in row])
    return ("﻿" + output.getvalue()).encode("utf-8")



# ---- Dashboard ----------------------------------------------------------------------------------------------------

def _months_back(month: str, count: int) -> list[str]:
    year, number = map(int, month.split("-"))
    result = []
    for _ in range(count):
        result.append(f"{year}-{number:02d}")
        number -= 1
        if number == 0:
            year, number = year - 1, 12
    return list(reversed(result))


def _budgets(db, months, region_ids):
    """Monthly Services budgets (TZS): allocated and used (claims charged), by month and region."""
    rows = db.query(MonthlyServiceBudget).filter(MonthlyServiceBudget.month.in_(months), MonthlyServiceBudget.currency == "TZS",
                                                 MonthlyServiceBudget.region_id.in_(region_ids or [-1]))
    result = defaultdict(lambda: defaultdict(lambda: {"allocated": ZERO, "used": ZERO}))
    for row in rows:
        cell = result[row.month][row.region_id]
        cell["allocated"] += row.allocated_amount
        cell["used"] += row.deducted_amount
    return result


def _budget_total(cells):
    allocated = sum((c["allocated"] for c in cells), ZERO)
    used = sum((c["used"] for c in cells), ZERO)
    return {"allocated": allocated, "used": used, "remaining": max(allocated - used, ZERO)}


def _money_of(totals):
    return {key: totals[key] for key in ("expected", "paid", "outstanding", "overpaid", "in_review")}


def dashboard(db, current, month: str, months: int = 6, region_id: int | None = None) -> dict:
    """Salary, Services and budget at a glance: the chosen month by region, cadre and funding source, and the months before."""
    reports.check_month(month)
    if not 1 <= months <= 12:
        raise HTTPException(422, "Show between 1 and 12 months.")
    sequence = _months_back(month, months)
    results = {m: build(db, current, m, region_id) for m in sequence}
    chosen = results[month]
    region_ids = [region_id] if region_id else [r["id"] for r in chosen["regions"]]
    budgets = _budgets(db, sequence, region_ids)
    trend = []
    for m in sequence:
        r = results[m]
        trend.append({"month": m, "payroll": _money_of(r["totals"]["PAYROLL"]), "services": _money_of(r["totals"]["SERVICES"]),
                      "budget": _budget_total(budgets[m].values()), "issues": len(r["issues"]),
                      "reconciled": bool(r["signoff"] and r["signoff"]["current"])})

    def grouped(key_of, label_of):
        groups = {}
        for row in chosen["providers"]:
            key = key_of(row)
            group = groups.setdefault(key, {"key": key, "label": label_of(row), "payroll_expected": ZERO, "payroll_paid": ZERO,
                                            "services_expected": ZERO, "services_paid": ZERO, "outstanding": ZERO, "issues": 0})
            prefix = "payroll" if row["work_type"] == "PAYROLL" else "services"
            group[f"{prefix}_expected"] += Decimal(row["expected"] or 0)
            group[f"{prefix}_paid"] += Decimal(row["paid"])
            group["outstanding"] += Decimal(row["outstanding"])
            group["issues"] += len(row["issues"])
        return groups

    names = {r["id"]: r["name"] for r in chosen["regions"]}
    by_region = grouped(lambda row: row["region_name"] or "—", lambda row: row["region_name"] or "—")
    for rid in region_ids:  # a region with a budget but no payments yet still shows its budget
        by_region.setdefault(names.get(rid, "—"), {"key": names.get(rid, "—"), "label": names.get(rid, "—"), "payroll_expected": ZERO,
                                                   "payroll_paid": ZERO, "services_expected": ZERO, "services_paid": ZERO,
                                                   "outstanding": ZERO, "issues": 0})
    for rid in region_ids:
        cell = budgets[month].get(rid, {"allocated": ZERO, "used": ZERO})
        group = by_region[names.get(rid, "—")]
        group["budget_allocated"], group["budget_used"] = cell["allocated"], cell["used"]
    by_cadre = grouped(lambda row: row["cadre_code"], lambda row: row["cadre_name"])
    funding = defaultdict(lambda: {"expected": ZERO, "paid": ZERO, "in_review": ZERO})
    for row in chosen["providers"]:
        if row["work_type"] == "SERVICES":
            cell = funding[row.get("funding_source") or "Not set"]
            cell["expected"] += Decimal(row["expected"] or 0)
            cell["paid"] += Decimal(row["paid"])
            cell["in_review"] += Decimal(row["in_review"])
    return _out({
        "month": month, "region_id": region_id, "months": trend, "regions": chosen["regions"],
        "totals": {"payroll": _money_of(chosen["totals"]["PAYROLL"]), "services": _money_of(chosen["totals"]["SERVICES"]),
                   "budget": _budget_total(budgets[month].values()), "issues": len(chosen["issues"]),
                   "providers": chosen["totals"]["all"]["providers"]},
        "by_region": sorted(by_region.values(), key=lambda g: g["label"]),
        "by_cadre": sorted(by_cadre.values(), key=lambda g: g["label"]),
        "by_funding": [{"source": key, **value} for key, value in sorted(funding.items())],
        "signoff": chosen["signoff"],
    })
