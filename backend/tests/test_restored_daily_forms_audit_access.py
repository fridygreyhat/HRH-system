"""Reporting and administrative audit visibility are independent of approval rights."""
from datetime import date, timedelta

import pytest

from .test_ctc_facility_approval import no_provider_sms


@pytest.mark.parametrize("code,provider,key", [
    ("HCP", "hcp1", "opd_screening"),
    ("DATA_CLERK", "clerk1", "data_clerk_daily_timesheet"),
])
def test_restored_monthly_forms_and_private_audit(api, db, period, monkeypatch, code, provider, key):
    from backend.core import workflow_policy
    from backend.models import BudgetLine, ClaimAudit, PaymentClaim, User, WorkLogAudit, WorkLogEntry
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    log = api.post("/worklogs", provider, {"period_id": period["id"], "work_type": "PAYROLL"})
    activity = next(item for item in log["cadre"]["activities"] if item["key"] == key)
    types = {field["key"]: field["field_type"] for field in log["cadre"]["fields"]}
    measures = {field: False if types[field] == "BOOLEAN" else 1 for field in activity["required_fields"]}
    assert measures
    if code == "DATA_CLERK":
        assert len(activity["groups"]) == 5
    else:
        assert {"opd_screening", "ctc_art_refills", "laboratory"} <= {item["key"] for item in log["cadre"]["activities"]}
    path = f"/worklogs/{log['id']}"
    first = date.fromisoformat(period["start_date"])
    end = date.fromisoformat(period["end_date"])
    def body(day, values):
        return {"activity_key": key, "start_time": "08:00:00",
                "end_time": "12:00:00" if day.weekday() == 5 else "16:00:00",
                "hours_worked": 4 if day.weekday() == 5 else 8, "measures": values}
    api.put(path + "/entries/" + first.isoformat(), provider, body(first, {}), expect=422)
    recorded = 0
    for offset in range((end - first).days + 1):
        day = first + timedelta(days=offset)
        if day.weekday() == 6:
            continue
        log = api.put(path + "/entries/" + day.isoformat(), provider, body(day, measures))
        recorded += 1
    assert len(log["entries"]) == recorded
    assert log["totals"]["measures"][activity["required_fields"][0]] == recorded
    # Recover editable snapshots whose reporting fields were previously stripped.
    entry = db.query(WorkLogEntry).filter_by(work_log_id=log["id"], entry_date=first).one()
    snapshot = dict(entry.activity_snapshot)
    snapshot.update(fields=[], required_fields=[], field_definitions=[], groups=[], rate_value="123")
    entry.activity_snapshot = snapshot
    db.commit()
    recovered = api.get(path, provider)
    assert next(item for item in recovered["cadre"]["activities"] if item["key"] == key)["fields"]
    api.put(path + "/entries/" + first.isoformat(), provider, body(first, measures))
    db.expire_all()
    assert db.get(WorkLogEntry, entry.id).activity_snapshot["rate_value"] == "123"
    # Non-admin viewers receive no full audit history, but retain approval actions.
    for viewer in (provider, "supervisor1", "tofficer1", "rpm1"):
        detail = api.get(path, viewer)
        assert detail["audit"] == []
        api.get("/admin/audit-events", viewer, expect=403)
    # Finance must not gain new access to draft Payroll logs as a side effect.
    api.get(path, "fhifin1", expect=404)
    api.get("/admin/audit-events", "fhifin1", expect=403)
    assert api.get(path, "admin")["audit"]
    api.get("/admin/audit-events", "central1")
    assert db.query(WorkLogAudit).filter_by(work_log_id=log["id"]).count() > 0
    submitted = api.post(path + "/actions/submit", provider, {"attest": True})
    assert submitted["audit"] == []
    returned = api.post(path + "/actions/return", "supervisor1", {
        "comment": "Please correct the recorded work hours",
        "review_type": "PAYROLL", "review_confirmed": True,
        "flags": [{"entry_date": first.isoformat(), "field": "hours", "note": "Confirm actual hours"}],
    })
    assert returned["status"] == "RETURNED_TO_PROVIDER"
    feedback = api.get(path, provider)
    assert feedback["audit"] == [] and feedback["review_feedback"][0]["comment"]
    assert feedback["review_feedback"][0]["details"]["flags"]
    assert "timestamp" not in feedback["review_feedback"][0]
    # Finance can still open an in-scope claim, without its audit history.
    line = db.query(BudgetLine).filter_by(period_id=period["id"], code="DEMO-A-01").one()
    admin_id = db.query(User.id).filter_by(username="admin").scalar()
    # Route A legacy claims are in this fixture finance user's existing scope.
    # Do not expand its Region × Cadre permissions just to make a test pass.
    claim = PaymentClaim(workflow_version=1, work_type="SERVICES",
                         staff_id=log["staff"]["id"], assignment_id=log["assignment"]["id"],
                         period_id=period["id"], category_id=line.category_id, route_code="A",
                         payor_org_id=line.organization_id, executor_org_id=line.organization_id,
                         amount=1, currency="TZS", status="DRAFT", created_by=admin_id)
    db.add(claim)
    db.flush()
    db.add(ClaimAudit(claim_id=claim.id, action="create", actor_id=admin_id))
    db.add(ClaimAudit(claim_id=claim.id, action="return", actor_id=admin_id,
                      new_status="DRAFT", comment="Current correction instructions"))
    db.commit()
    finance_claim = api.get(f"/claims/{claim.id}", "fhifin1")
    assert finance_claim["audit"] == []
    assert finance_claim["review_feedback"][0]["comment"] == "Current correction instructions"
    assert api.get(f"/claims/{claim.id}", "admin")["audit"]
