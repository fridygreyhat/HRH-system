"""Regional Finance signs aggregate reports, CSO Finance only receives published scope."""
from datetime import date

import pytest

from backend.models import FinanceMonthlyReport, PaymentClaim, WorkLogMeasure, utcnow
from .test_finance_monthly_reports import all_cadres
from .test_finance_missing_rates import unpriced_log
from .test_v22_finance import v22


@pytest.mark.parametrize("work_type", ["PAYROLL", "SERVICES"])
def test_monthly_signoff_exports_and_revisions(api, db, period, v22, work_type):
    region = v22["region_id"]
    month = date.fromisoformat(period["start_date"]).strftime("%Y-%m")
    rf = v22["finance"]
    all_cadres(db, rf)
    all_cadres(db, "csofin1")
    path = f"/finance/monthly-report?month={month}&region_id={region}&work_type={work_type}"
    old_path = f"/finance/monthly-summary?month={month}&region_id={region}&work_type={work_type}"
    export = f"/finance/monthly-report/export?month={month}&region_id={region}&work_type={work_type}"
    logs = []
    for provider in ("chw1", "hcp1"):
        log, entry, _ = unpriced_log(db, period, provider, work_type)
        log.status = "APPROVED" if work_type == "PAYROLL" else "PENDING_FINANCE_REVIEW"
        log.approved_at = utcnow()
        entry.activity_snapshot = {**entry.activity_snapshot,
                                   "field_definitions": [{"key": "clients", "label_en": "Clients served"}]}
        db.add(WorkLogMeasure(entry_id=entry.id, field_key="clients", value=5))
        logs.append(log.id)
    db.commit()

    assert api.get(path, "csofin1")["report"]["providers"] == []
    assert api.get(old_path, "csofin1")["providers"] == []  # legacy endpoint cannot leak draft work
    api.get(export + "&format=csv", "csofin1", expect=404)
    api.post("/finance/monthly-report/approve", "csofin1", {
        "month": month, "region_id": region, "work_type": work_type,
        "review_confirmed": True, "expected_digest": "0" * 64}, expect=403)
    api.get(path, "chw1", expect=403)
    api.get(path, "csofin3", expect=403)  # different CSO, not assigned to this region

    review = api.get(path, rf)
    assert review["can_approve"] and review["report"]["totals"]["providers"] == 2
    assert review["report"]["totals"]["hours"] != "0"
    assert {p["cadre_code"] for p in review["report"]["providers"]} == {"CHW", "HCP"}
    payload = {"month": month, "region_id": region, "work_type": work_type,
               "review_confirmed": True, "expected_digest": review["digest"]}
    api.post("/finance/monthly-report/approve", rf, {**payload, "review_confirmed": False}, expect=422)
    api.post("/finance/monthly-report/approve", rf, {**payload, "expected_digest": "0" * 64}, expect=409)
    signed = api.post("/finance/monthly-report/approve", rf, payload)
    assert signed["state"] == "APPROVED" and not signed["stale"]
    assert signed["approval"]["region_id"] == region
    assert api.post("/finance/monthly-report/approve", rf, payload)["approval"]["id"] == signed["approval"]["id"]
    assert db.query(FinanceMonthlyReport).filter_by(month=month, region_id=region, work_type=work_type).count() == 1
    published = api.get(path, "csofin1")
    assert published["state"] == "APPROVED" and published["report"]["totals"]["providers"] == 2
    assert published["can_approve"] is False and published["report"]["totals"]["hours"] == review["report"]["totals"]["hours"]
    assert api.get(old_path, "csofin1")["totals"]["providers"] == 2

    for fmt, content_type, prefix in (("csv", "text/csv", b"\xef\xbb\xbf"),
                                       ("pdf", "application/pdf", b"%PDF")):
        response = api.client.get(export + f"&format={fmt}",
                                  headers={"Authorization": f"Bearer {api.token('csofin1')}"})
        assert response.status_code == 200, response.text[:300] if response.status_code != 200 else ""
        assert content_type in response.headers["content-type"]
        assert "attachment" in response.headers["content-disposition"]
        assert response.headers["cache-control"] == "no-store"
        assert response.content.startswith(prefix)
        assert len(response.content) > 300
    csv_response = api.client.get(export + "&format=csv",
                 headers={"Authorization": f"Bearer {api.token('csofin1')}"})
    assert "CHW" in csv_response.content.decode("utf-8-sig")
    assert "Clients served" in csv_response.content.decode("utf-8-sig")

    # Later RM-authorized work must not silently change the CSO's approved snapshot.
    third, _, _ = unpriced_log(db, period, "clerk1", work_type)
    third.status = "APPROVED" if work_type == "PAYROLL" else "PENDING_FINANCE_REVIEW"
    third.approved_at = utcnow()
    logs.append(third.id)
    db.commit()
    changed = api.get(path, rf)
    assert changed["stale"] and changed["report"]["totals"]["providers"] == 3
    assert api.get(path, "csofin1")["report"]["totals"]["providers"] == 2
    api.post("/finance/monthly-report/approve", rf, payload, expect=409)
    revised = api.post("/finance/monthly-report/approve", rf, {**payload, "expected_digest": changed["digest"]})
    assert revised["approval"]["id"] != signed["approval"]["id"] and not revised["stale"]
    assert db.query(FinanceMonthlyReport).filter_by(month=month, region_id=region, work_type=work_type).count() == 2
    assert api.get(path, "csofin1")["report"]["totals"]["providers"] == 3
    assert db.query(PaymentClaim).filter(PaymentClaim.work_log_id.in_(logs)).count() == 0


def test_partial_regional_finance_scope_cannot_approve_whole_report(api, db, period, v22):
    from backend.models import User, UserReviewCadre
    rf = v22["finance"]
    log, entry, _ = unpriced_log(db, period, "chw1", "PAYROLL")
    log.status, log.approved_at = "APPROVED", utcnow()
    db.commit()
    report = api.get(f"/finance/monthly-report?month={entry.entry_date:%Y-%m}&region_id={v22['region_id']}", rf)
    assert not report["can_approve"]
    api.post("/finance/monthly-report/approve", rf, {"month": str(entry.entry_date)[:7],
        "region_id": v22["region_id"], "work_type": "PAYROLL",
        "review_confirmed": True, "expected_digest": report["digest"]}, expect=403)


def test_whole_region_report_includes_authorized_work_by_a_linked_finance_user(api, db, period, v22):
    from backend.core.security import load_current_user
    from backend.models import Staff, User
    from backend.services.finance_reports import monthly_summary

    all_cadres(db, v22["finance"])
    log, entry, _ = unpriced_log(db, period, "chw1", "PAYROLL")
    log.status, log.approved_at = "APPROVED", utcnow()
    db.commit()
    actor = load_current_user(db, db.query(User).filter_by(username=v22["finance"]).one())
    actor.staff = db.get(Staff, log.staff_id)
    report = monthly_summary(db, actor, str(entry.entry_date)[:7], v22["region_id"], "PAYROLL")
    assert report["totals"]["providers"] == 1
    assert report["providers"][0]["staff_id"] == log.staff_id
