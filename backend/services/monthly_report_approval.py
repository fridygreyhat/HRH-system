"""Snapshot-based report publication; never creates claims or moves payment status."""
import hashlib
import json
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import or_
from ..models import Cadre, CSORegionAssignment, FinanceMonthlyReport, Region, StaffAssignment
from ..core.roles import REGIONAL_FINANCE, FHI360_FINANCE, CSO_FINANCE
from ..core import audit
from .finance_reports import monthly_summary
from .v22_scope import regions_for


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
        providers = [p for p in report["providers"] if p["cadre_code"] in codes]
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


def view(db, current, month, region_id, work_type):
    # Validate month even when there is no published snapshot.
    from datetime import date
    try:
        year, number = map(int, month.split("-"))
        date(year, number, 1)
        if not 2000 <= year <= 2100:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, "Select a valid calendar month between 2000 and 2100.")
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


def approve(db, current, data):
    if not data.review_confirmed:
        raise HTTPException(422, "Confirm that you reviewed the complete regional monthly report.")
    if not can_approve(db, current, data.region_id):
        raise HTTPException(403, "Regional Finance must cover this region and all CHW, HCP and Data Clerk cadres to approve the whole report.")
    region = db.query(Region).filter_by(id=data.region_id).with_for_update().one_or_none()
    if not region:
        raise HTTPException(404, "Region not found.")
    result = view(db, current, data.month, data.region_id, data.work_type)
    if result["digest"] != data.expected_digest:
        raise HTTPException(409, "The monthly report changed. Refresh and review it before approving.")
    if not result["report"]["providers"]:
        raise HTTPException(422, "There is no RM-authorized work to approve for this region and month.")
    previous = latest(db, data.month, data.region_id, data.work_type)
    if previous and previous.digest == result["digest"]:
        return result
    organizations = {}
    for org, in db.query(StaffAssignment.organization_id).filter(
            StaffAssignment.region_id == region.id, StaffAssignment.organization_id.isnot(None)).distinct():
        organizations[str(org)] = monthly_summary(db, current, data.month, region.id, data.work_type, organization_id=org)
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
