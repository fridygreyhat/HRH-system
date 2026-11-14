"""Snapshot-based report publication; never creates claims or moves payment status."""
import hashlib
import json
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import or_
from ..models import Cadre, CadreFormField, CSORegionAssignment, FinanceMonthlyReport, Region, StaffAssignment
from ..core.roles import REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE
from ..core import audit
from ..core.period_dates import pay_month_of, pay_month_range
from ..core.timeutil import local_today
from .finance_reports import monthly_summary, pay_month_sql, report_counts
from .v22_scope import regions_for


# Saved for the salary timesheet files only; the on-screen report stays aggregate.
TIMESHEET_KEYS = ("attendance", "salary_scale", "days_signed", "community_area_name")


def cso_only(current):
    return not current.unrestricted and current.has_any(CSO_FINANCE) and not current.has_any(REGIONAL_FINANCE, FHI360_FINANCE)


def cso_regions(db, current):
    organizations = current.scope_values("organization_id")
    assigned = {row[0] for row in db.query(CSORegionAssignment.region_id).filter(
        CSORegionAssignment.organization_id.in_(organizations), CSORegionAssignment.is_active.is_(True))}
    # A signed report is documentation for its named CSO, not permission to
    # execute payments. Missing/revoked payment routing must not hide that
    # organization's already-published records. Explicit user region limits
    # and current organization/cadre grants still apply below and in view().
    if organizations:
        assigned |= {row[0] for row in db.query(FinanceMonthlyReport.region_id).filter(
            FinanceMonthlyReport.work_type == "PAYROLL",
            or_(*(FinanceMonthlyReport.snapshot["organizations"].has_key(str(org))
                  for org in organizations)))}
    explicit = regions_for(current)
    return assigned & explicit if explicit else assigned


def digest(report):
    return hashlib.sha256(json.dumps(report, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def empty(month, work_type):
    return {"month": month, "work_type": work_type, "providers": [], "cadres": [],
            "totals": {"providers": 0, "logs": 0, "days": 0, "hours": "0"}}


def metadata(db, row):
    return {"id": row.id, "month": row.month, "work_type": row.work_type,
            "region_id": row.region_id, "region_name": row.snapshot["region_name"],
            "approved_at": row.approved_at.isoformat(),
            "approved_by_name": row.snapshot["approved_by_name"]}


def required_cadres(db):
    return {row.id for row in db.query(Cadre).filter(Cadre.code.in_(["CHW", "HCP", "DATA_CLERK"]))}


def can_approve(db, current, region_id):
    return bool(region_id) and (current.unrestricted or (
        current.has_any(REGIONAL_FINANCE) and region_id in regions_for(current)
        and required_cadres(db).issubset(current.review_cadres)))


def latest(db, month, region_id, work_type):
    return db.query(FinanceMonthlyReport).filter_by(month=month, region_id=region_id, work_type=work_type).order_by(FinanceMonthlyReport.id.desc()).first()


def merge_reports(reports, month, work_type, codes):
    result = empty(month, work_type)
    groups = {}
    for report in reports:
        providers = [{key: value for key, value in p.items() if key not in TIMESHEET_KEYS}
                     for p in report["providers"] if p["cadre_code"] in codes]
        result["providers"].extend(providers)
        # Source report logs are never needed for CSO documentation; provider totals are authoritative.
        for p in providers:
            g = groups.setdefault(p["cadre_code"], {"code": p["cadre_code"], "name": p["cadre_name"],
                "days": 0, "hours": Decimal(0), "staff": set(), "indicators": {}})
            g["days"] += p["days"]
            g["hours"] += Decimal(p["hours"])
            g["staff"].add(p["staff_id"])
            for indicator in p["indicators"]:
                value = g["indicators"].setdefault(indicator["key"], {**indicator, "total": Decimal(0)})
                value["total"] += Decimal(indicator["total"])
    for code, g in sorted(groups.items()):
        result["cadres"].append({"code": code, "name": g["name"], "days": g["days"],
            "hours": str(g["hours"]), "provider_count": len(g["staff"]),
            "indicators": [{**i, "total": str(i["total"])} for _, i in sorted(g["indicators"].items())]})
    result["totals"] = {"providers": len({p["staff_id"] for p in result["providers"]}),
        "logs": sum(p.get("logs", 0) for p in result["providers"]),
        "days": sum(p["days"] for p in result["providers"]),
        "hours": str(sum((Decimal(p["hours"]) for p in result["providers"]), Decimal(0)))}
    return result


def check_month(month):
    from datetime import date
    try:
        year, number = map(int, month.split("-"))
        date(year, number, 1)
        if not 2000 <= year <= 2100:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Select a valid calendar month between 2000 and 2100.")


def labels_sw(db, report) -> dict:
    """Swahili names for the report's indicators. Kept beside the report, not in it, so signed digests do not change."""
    keys = {indicator["key"] for group in ("cadres", "providers") for item in report.get(group, []) for indicator in item.get("indicators", [])}
    if not keys:
        return {}
    return {key: label for key, label in db.query(CadreFormField.key, CadreFormField.label_sw).filter(CadreFormField.key.in_(keys)) if label}


def view(db, current, month, region_id, work_type):
    result = _view(db, current, month, region_id, work_type)
    return {**result, "labels_sw": labels_sw(db, result["report"])}


SERVICES_NOT_FOR_CSO = "Services go to FHI360 Central Finance, not to the CSO. The CSO receives the signed Payroll report."


def _view(db, current, month, region_id, work_type):
    # Validate month even when there is no published snapshot.
    check_month(month)
    if cso_only(current) and work_type != "PAYROLL":
        # Payroll is the CSO's; Services are paid by FHI360, so their report never reaches the CSO.
        raise HTTPException(403, SERVICES_NOT_FOR_CSO)
    allowed = cso_regions(db, current) if cso_only(current) else regions_for(current)
    if region_id and not current.unrestricted and region_id not in allowed:
        raise HTTPException(403, "This region is outside your assigned scope.")
    row = latest(db, month, region_id, work_type) if region_id else None
    if cso_only(current):
        region_ids = {region_id} if region_id else allowed
        codes = {c.code for c in db.query(Cadre).filter(Cadre.id.in_(current.review_cadres))}
        published, approvals = [], []
        for region in sorted(region_ids):
            approved = latest(db, month, region, work_type)
            if not approved:
                continue
            has_rows = False
            for org in current.scope_values("organization_id"):
                scoped = approved.snapshot["organizations"].get(str(org))
                if scoped:
                    published.append(scoped)
                    has_rows = has_rows or any(p["cadre_code"] in codes for p in scoped["providers"])
            if has_rows:
                approvals.append(metadata(db, approved))
        report = merge_reports(published, month, work_type, codes)
        return {"state": "APPROVED" if approvals else "NOT_APPROVED",
                "approval": approvals[0] if len(approvals) == 1 else None, "approvals": approvals,
                "can_approve": False, "stale": False, "digest": None, "report": report}
    report = monthly_summary(db, current, month, region_id, work_type)
    current_digest = digest(report)
    return {"state": "APPROVED" if row else "NOT_APPROVED", "approval": metadata(db, row) if row else None,
            "can_approve": can_approve(db, current, region_id), "digest": current_digest,
            "stale": bool(row and row.digest != current_digest), "report": report}


# Pay months Regional Finance is reminded about: the last ones that have closed (the open month is signed after its 25th).
STATUS_MONTHS = 3
WORK_TYPE_ORDER = {"PAYROLL": 0, "SERVICES": 1}  # Payroll first: its sign-off is what the CSO receives


def previous_month(month):
    year, number = map(int, month.split("-"))
    return f"{year - 1}-12" if number == 1 else f"{year}-{number - 1:02d}"


def _to_approve(db, current, month, region_id):
    from .finance_bulk import payroll_waiting
    return payroll_waiting(db, current, month, region_id)


def signoff_status(db, current, today=None):
    """Every regional report with RM-authorized work in the recent closed pay months, and whether it is signed.

    Payroll and Services are signed separately, and only the Payroll sign-off reaches the CSO, so a signed Services
    report must not hide an unsigned Payroll one."""
    months, month = [], pay_month_of(today or local_today())
    for _ in range(STATUS_MONTHS):
        month = previous_month(month)
        months.append(month)
    counts = report_counts(db, current, pay_month_range(months[-1])[0], pay_month_range(months[0])[1])
    allowed = regions_for(current)
    counts = {key: value for key, value in counts.items() if key[2] in months and (current.unrestricted or key[0] in allowed)}
    names = {r.id: r.name for r in db.query(Region).filter(Region.id.in_({key[0] for key in counts}))}
    items = []
    for (region_id, work_type, month), (providers, logs, changed) in counts.items():
        row = latest(db, month, region_id, work_type)
        if not row:
            state = "NOT_SIGNED"
        elif logs == row.snapshot["regional"]["totals"]["logs"] and changed and changed <= row.approved_at:
            state = "SIGNED"  # nothing approved, edited or withdrawn since the sign-off: no need to rebuild the report
        else:  # something moved since signing: compare the exact signed document
            state = "SIGNED" if row.digest == digest(monthly_summary(db, current, month, region_id, work_type)) else "CHANGED"
        items.append({
            "month": month, "region_id": region_id, "region_name": names[region_id], "work_type": work_type,
            "state": state, "providers": providers,
            "approved_at": row.approved_at.isoformat() if row else None,
            "approved_by_name": row.snapshot["approved_by_name"] if row else None,
            "can_approve": can_approve(db, current, region_id),
            "to_approve": _to_approve(db, current, month, region_id) if work_type == "PAYROLL" else 0,
        })
    # Waiting first, newest month first, Payroll before Services.
    items.sort(key=lambda i: (i["state"] == "SIGNED", -int(i["month"].replace("-", "")),
                              WORK_TYPE_ORDER[i["work_type"]], i["region_name"]))
    return items


def cso_payroll_status(db, current, today=None):
    """For CSO Finance: each recent pay month and region where its providers have RM-approved Payroll, and whether
    Regional Finance has signed it (sent it to the CSO). Counts only: names stay unseen until the report is signed."""
    from sqlalchemy import func
    from ..core.workflow_policy import RM_AUTHORIZED_STATUSES
    from ..models import WorkLog, WorkLogEntry
    organizations = current.scope_values("organization_id")
    regions = cso_regions(db, current)
    if not organizations or not regions:
        return []
    months, month = [], pay_month_of(today or local_today())
    for _ in range(STATUS_MONTHS):
        month = previous_month(month)
        months.append(month)
    start, end = pay_month_range(months[-1])[0], pay_month_range(months[0])[1]
    pay_month = pay_month_sql(WorkLogEntry.entry_date)
    rows = (db.query(StaffAssignment.region_id, pay_month, func.count(func.distinct(WorkLog.staff_id)))
            .join(WorkLog, WorkLog.assignment_id == StaffAssignment.id)
            .join(WorkLogEntry, WorkLogEntry.work_log_id == WorkLog.id)
            .filter(WorkLog.work_type == "PAYROLL", WorkLog.status.in_(RM_AUTHORIZED_STATUSES),
                    StaffAssignment.organization_id.in_(organizations), StaffAssignment.region_id.in_(regions),
                    WorkLog.cadre_id.in_(current.review_cadres or {-1}),
                    WorkLogEntry.entry_date >= start, WorkLogEntry.entry_date <= end)
            .group_by(StaffAssignment.region_id, pay_month))
    approved = {(region, month): count for region, month, count in rows if month in months}
    names = {r.id: r.name for r in db.query(Region).filter(Region.id.in_(regions))}
    codes = {c.code for c in db.query(Cadre).filter(Cadre.id.in_(current.review_cadres))}
    items = []
    for (region, month), count in approved.items():
        row = latest(db, month, region, "PAYROLL")
        signed = 0
        if row:
            signed = len({p["staff_id"] for org in organizations
                          for p in (row.snapshot["organizations"].get(str(org)) or {"providers": []})["providers"]
                          if p["cadre_code"] in codes})
        items.append({"month": month, "region_id": region, "region_name": names[region], "approved_providers": count,
                      "state": "SIGNED" if row and signed else "WAITING", "signed_providers": signed,
                      "approved_by_name": row.snapshot["approved_by_name"] if row else None,
                      "approved_at": row.approved_at.isoformat() if row else None})
    items.sort(key=lambda i: (i["state"] == "SIGNED", -int(i["month"].replace("-", "")), i["region_name"]))
    return items


def approve(db, current, data):
    if not data.review_confirmed:
        raise HTTPException(422, "Confirm that you reviewed the complete regional monthly report.")
    if not can_approve(db, current, data.region_id):
        raise HTTPException(403, "Regional Finance must cover this region and all CHW, HCP and Data Clerk cadres to approve the whole report.")
    if data.work_type == "PAYROLL":
        from .finance_bulk import payroll_waiting
        waiting = payroll_waiting(db, current, data.month, data.region_id)
        if waiting:
            raise HTTPException(409, f"{waiting} Payroll {'timesheet is' if waiting == 1 else 'timesheets are'} not approved yet. "
                                     "Approve them (or return the ones that should not be paid) before signing and sending to the CSO.")
    region = db.query(Region).filter_by(id=data.region_id).with_for_update().one_or_none()
    if not region:
        raise HTTPException(404, "Region not found.")
    result = view(db, current, data.month, data.region_id, data.work_type)
    if result["digest"] != data.expected_digest:
        raise HTTPException(409, "The monthly report changed. Refresh and review it before approving.")
    if not result["report"]["providers"]:
        raise HTTPException(422, "There is no RM-authorized work to approve for this region and month.")
    organizations = {}
    # Only Payroll goes to the CSO: a Services sign-off keeps no CSO copy (Services are paid by FHI360).
    for org, in (db.query(StaffAssignment.organization_id).filter(
            StaffAssignment.region_id == region.id, StaffAssignment.organization_id.isnot(None)).distinct()
            if data.work_type == "PAYROLL" else []):
        organizations[str(org)] = monthly_summary(db, current, data.month, region.id, data.work_type,
                                                  organization_id=org, daily=True)
    previous = latest(db, data.month, data.region_id, data.work_type)
    # The digest covers the regional report only. A corrected CSO or placement must still reach the CSO's copy.
    if previous and previous.digest == result["digest"] and previous.snapshot["organizations"] == organizations:
        return result
    row = FinanceMonthlyReport(region_id=region.id, month=data.month, work_type=data.work_type,
        approved_by=current.id, digest=result["digest"],
        snapshot={"region_name": region.name, "approved_by_name": current.user.full_name or current.user.username,
                  "regional": result["report"], "organizations": organizations})
    db.add(row)
    db.flush()
    audit.record(db, current, "finance_monthly_report", row.id, "approve",
                 after={"month": data.month, "region_id": region.id,
                        "work_type": data.work_type, "digest": result["digest"]})
    db.commit()
    return view(db, current, data.month, region.id, data.work_type)
