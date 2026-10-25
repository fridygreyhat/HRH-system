"""Preserved legacy routes shown separately from the new direct-CSO pipeline."""
from .conftest import approved_log, category_id
from .demo_capture import capture
from ..services.demo_walkthrough import sample_proof_pdf


def legacy_scenario(api, db, period, route):
    scenario = {
        "id": f"legacy-route-{route.lower()}", "title": f"Legacy Route {route}",
        "region": "Iringa", "cadre": "HCP" if route == "B" else "CHW",
        "work_type": "LEGACY", "route": route, "variant": "legacy",
        "provider_label": "DEMO historical provider",
        "description": (
            "Preserved legacy workflow, not the default for new records. "
            + ("FHI360 batches and hands payroll to the assigned CSO." if route == "B" else
               "A standalone community claim needs community verification and CSO approval.")
        ), "steps": [],
    }
    log_id = None
    if route == "B":
        log = approved_log(api, "hcp1", period)
        log_id = log["id"]
        claim = api.post("/claims", "fhifin1", {"work_log_id": log_id, "category_id": category_id(db, "B")})
    else:
        from ..models import Staff, User
        staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
        claim = api.post("/claims", "csofin1", {
            "category_id": category_id(db, "C"), "staff_id": staff.id, "period_id": period["id"],
            "evidence_text": "SIMULATED community outreach, no real patient data",
            "declared_units": {"days": 4, "clients_followed_up": 10},
        })
    cid, batch_id = claim["id"], None
    preparer, approver = ("fhifin1", "fhifin2") if route == "B" else ("csofin1", "csofin2")
    owner_role = "FHI360_FINANCE" if route == "B" else "CSO_FINANCE"

    def snap(title, role, username, action, explanation, expected):
        return capture(api, scenario, title=title, role=role, actor=f"DEMO {role.replace('_', ' ').title()}",
                       username=username, action=action, explanation=explanation, expected=expected,
                       log_id=log_id, claim_id=cid, batch_id=batch_id)

    if route == "C":
        snap("Community-originated claim", "COMMUNITY_VERIFIER", "verifier1", "Verify community work",
             "Only the assigned community verifier can verify this standalone legacy claim.",
             "PENDING_COMMUNITY_VERIFICATION, not payable.")
        api.post(f"/claims/{cid}/actions/verify_community", "verifier1")
    snap("Legacy claim prepared", owner_role, preparer, "Submit claim",
         "The approved work or verified community evidence is priced using the preserved legacy rules.",
         "Legacy claims follow their original approval family; new records cannot opt into this path.")
    api.post(f"/claims/{cid}/actions/submit", preparer)
    snap("Independent claim approval", owner_role, approver, "Approve",
         "A second person approves the claim. The preparer cannot approve their own claim.",
         "Budget is committed only after independent approval succeeds.")
    api.post(f"/claims/{cid}/actions/approve", approver)
    api.post(f"/claims/{cid}/actions/mark_ready", approver)
    snap("Legacy claim ready", owner_role, approver, "Create batch",
         "Ready is not paid. Export is an auditable, separate step.",
         "READY, with no payment transfer.")
    batches = api.post("/batches", preparer, {"route_code": route})
    batch_id = next(b["id"] for b in batches if any(l["claim_id"] == cid for l in api.get(f"/batches/{b['id']}", preparer)["lines"]))
    for fmt in ("csv", "xlsx"):
        assert api.call("GET", f"/batches/{batch_id}/export.{fmt}", preparer).content
    snap("Legacy batch exported", owner_role, preparer, "Hand off" if route == "B" else "Record external payment",
         "Both CSV and XLSX exports contain the simulated register.",
         "EXPORTED does not mean money was sent.")
    if route == "B":
        api.post(f"/batches/{batch_id}/hand-off", "fhifin1")
        snap("FHI360 hands off to CSO", "CSO_FINANCE", "csofin1", "Acknowledge receipt",
             "This handoff belongs only to legacy Route B, not new payroll.",
             "The assigned CSO must acknowledge before recording payment.")
        api.post(f"/batches/{batch_id}/receive", "csofin1")
    api.post(f"/claims/{cid}/payments", "csofin1", {
        "amount": claim["amount"], "payment_reference": f"SIMULATED-LEGACY-{route}",
        "payment_date": period["start_date"],
    })
    snap("Legacy payment needs proof", "CSO_FINANCE", "csofin1", "Upload sample proof",
         "An external payment record exists, but required evidence is still missing.",
         "PROOF_REQUIRED; no real transfer occurred.")
    api.call("POST", f"/claims/{cid}/proofs", "csofin1",
             files={"file": ("DEMO-NOT-REAL-PAYMENT.pdf", sample_proof_pdf(), "application/pdf")})
    api.post(f"/claims/{cid}/actions/confirm_paid", "csofin1")
    paid = snap("Legacy payment confirmed", "CSO_FINANCE", "csofin1", "Independent reconciliation",
                "Required simulated payment evidence and full amount are present.",
                "PAID; the historical workflow remains distinct from new records.")
    assert paid["claim"]["payment_status"] == "PAID"
    reconciler = "fhifin1" if route == "B" else "csofin2"
    api.post(f"/claims/{cid}/actions/reconcile", reconciler, {"comment": "SIMULATED independent reconciliation"})
    snap("Legacy record reconciled", "FHI360_FINANCE" if route == "B" else "CSO_FINANCE",
         reconciler, "View complete audit",
         "A person other than the recorder reconciles the simulated record.",
         "RECONCILED; immutable claim history is retained.")
    return scenario
