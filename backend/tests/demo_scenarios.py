"""Execute the real approval/payment APIs using synthetic, isolated records."""
from decimal import Decimal

from .conftest import category_id
from .demo_capture import capture
from ..services.demo_walkthrough import sample_proof_pdf


def new_scenario(api, db, period, provider, kind, variant="happy_path"):
    route = "A" if kind == "SERVICES" else "B"
    region, cadre = provider["region"], provider["cadre"]
    scenario = {
        "id": f"{region}-{cadre}-{kind}-{variant}".lower(),
        "title": f"{region} · {cadre} · {kind.title()}",
        "region": region, "cadre": cadre, "work_type": kind, "route": route,
        "variant": variant, "provider_label": f"DEMO {cadre} · {region}",
        "description": (
            "New-record workflow. Recorded rates are fixed; RPM approves work, "
            "Regional Finance reviews and routes, and the payor records an external payment. "
            "All SMS, payment references and proof files in this replay are simulated."
        ),
        "steps": [],
    }
    usernames = {
        "PROVIDER": provider["username"],
        "SUPERVISOR": "supervisor1" if region == "Iringa" else "demo_ctc_njombe",
        "FACILITY_IN_CHARGE": "facilityic1" if region == "Iringa" else "demo_ctc_njombe",
        "TECHNICAL_OFFICER": "demo_technical_" + cadre.lower(),
        "RPM": "rpm1" if region == "Iringa" else "rpm2",
        "REGIONAL_FINANCE": "demo_regional_" + region.lower(),
    }
    payer_role = "FHI360_FINANCE" if route == "A" else "CSO_FINANCE"
    usernames[payer_role] = "fhifin1" if route == "A" else ("csofin1" if region == "Iringa" else "csofin3")
    reconciler = "fhifin2" if route == "A" else ("csofin2" if region == "Iringa" else "demo_cso_njombe_review")
    reviewer = usernames["TECHNICAL_OFFICER"]
    activity = api.post("/rates", reviewer, {
        "label_en": f"DEMO {kind.title()} · {cadre}", "label_sw": f"DEMO {kind.title()}",
        "cadre_id": provider["cadre_id"], "region_id": provider["region_id"],
        "item_type": kind, "form_mode": "SINGLE", "rate_value": 2500 if kind == "PAYROLL" else 500,
        "currency": "TZS", "unit_type": "PER_HOUR" if kind == "PAYROLL" else "PER_UNIT",
        "effective_start_date": period["start_date"],
    })
    log = api.post("/worklogs", provider["username"], {"period_id": period["id"], "work_type": kind})
    log_id, claim_id, batch_id = log["id"], None, None
    body = {
        "activity_key": activity["key"], "hours_worked": 2,
        "evidence_text": "SIMULATED DEMO: aggregate counts only; no patient information",
        "measures": {k: 3 for k in activity["fields"]},
        **({"start_time": "08:00", "end_time": "10:00"} if kind == "SERVICES" and cadre != "CHW" else {}),
    }
    api.put(f"/worklogs/{log_id}/entries/{period['start_date']}", provider["username"], body)

    def snap(title, role, action, explanation, expected, username=None):
        return capture(api, scenario, title=title, role=role,
                       actor=f"DEMO {role.replace('_', ' ').title()} · {region}",
                       username=username or usernames[role], action=action,
                       explanation=explanation, expected=expected, log_id=log_id,
                       claim_id=claim_id, batch_id=batch_id)

    def act(action, role, **extra):
        return api.post(f"/worklogs/{log_id}/actions/{action}", usernames[role],
                        {"review_confirmed": True, "review_type": kind, **extra})

    snap("Provider records the work", "PROVIDER", "Submit work log",
         "The provider records the activity, hours and aggregate counts, then attests.",
         "DRAFT; no claim, budget commitment or payment exists.")
    act("submit", "PROVIDER", attest=True)
    snap("CTC verification", "SUPERVISOR", "Verify work",
         "The facility/CTC reviewer cross-checks all entries and monthly totals.",
         "Only the assigned facility reviewer can verify this work.")
    if variant == "return":
        act("return", "SUPERVISOR", comment="DEMO: correct the aggregate activity count")
        snap("Returned for correction", "PROVIDER", "Correct and resubmit",
             "The reviewer gives a reason. The provider corrects the returned record, not an approved record.",
             "RETURNED; no financial claim or payment has been created.")
        body["measures"] = {k: 4 for k in activity["fields"]}
        api.put(f"/worklogs/{log_id}/entries/{period['start_date']}", provider["username"], body)
        act("submit", "PROVIDER", attest=True)
        snap("Correction resubmitted", "SUPERVISOR", "Verify corrected work",
             "The original return remains in the audit trail.",
             "The corrected version must be verified and confirmed again.")
    verified = act("verify", "SUPERVISOR")
    snap("Provider SMS confirmation", "PROVIDER", "Confirm verified version",
         "In this isolated test only, the mock gateway supplies the one-time code. No code is stored in this demo replay.",
         "The confirmation applies to the exact CTC-verified version; no real SMS is sent.")
    api.post(f"/worklogs/{log_id}/otp/confirm", provider["username"], {"code": verified["otp"]["dev_otp"]})
    if cadre == "HCP":
        snap("Facility endorsement", "FACILITY_IN_CHARGE", "Endorse facility work",
             "HCP records require supplemental facility endorsement before technical approval.",
             "The facility endorsement is recorded with its actor and version.")
        act("facility_endorse", "FACILITY_IN_CHARGE", comment="DEMO: facility records match")
    snap("Cadre-specific technical review", "TECHNICAL_OFFICER", "Endorse",
         f"The {cadre} technical reviewer sees only their assigned cadres and regions.",
         "Technical approval confirms the work, not a payment.")
    act("endorse", "TECHNICAL_OFFICER")
    snap("RPM operational approval", "RPM", "Authorize work",
         "RPM authority covers every cadre in the assigned region. The RPM cannot channel or pay.",
         "Approval atomically creates the priced claim from recorded activity rates.")
    approved = act("authorize", "RPM")
    claim_id = next(c["id"] for c in approved["claims"] if c["status"] != "CANCELLED")
    pending = snap("Claim automatically prepared", "REGIONAL_FINANCE", "Review amount and category",
                   "Finance receives the same liability created by RPM; it has no category, payor or budget commitment yet.",
                   "PENDING_FINANCE_REVIEW; not batchable or payable.")
    assert pending["claim"]["status"] == "PENDING_FINANCE_REVIEW"
    assert pending["claim"]["category_name"] is None
    assert not pending["claim"]["payment_actions"]
    reviewed = act("finance_review", "REGIONAL_FINANCE", category_id=category_id(db, route))
    snap("Explicit payor selection", "REGIONAL_FINANCE", "Channel to eligible payor",
         "Finance selects FHI360 for Services, or the provider's assigned CSO for Payroll. Another payor is not eligible.",
         "PENDING_ROUTING; finance review alone does not commit budget or mark paid.")
    routed = api.post("/finance/channel", usernames["REGIONAL_FINANCE"], {
        "claim_id": claim_id, "target_payor_id": reviewed["finance_snapshot"]["payor_org_id"],
        "review_confirmed": True, "review_type": kind,
    })
    if variant == "budget_hold":
        assert routed["status"] == "BUDGET_HOLD"
        snap("Insufficient-budget hold", "RPM", "Review budget shortfall",
             "Both log and claim are held. The RPM receives the budget alert, but cannot mark the claim paid.",
             "BUDGET_HOLD; no payment or export may proceed.")
        from ..models import BudgetLine, ClaimCategory
        line = db.get(BudgetLine, reviewed["finance_snapshot"]["budget_line_id"])
        # The reserve is a distinct category, not a competing allocation for
        # the reviewed category (which would deliberately invalidate routing).
        reserve_category = ClaimCategory(name="DEMO reserve - not a payable category",
                                         budget_owner="PAYOR", origin_channel="FACILITY")
        db.add(reserve_category)
        db.commit()
        reserve = api.post("/budgets/lines", usernames[payer_role], {
            "code": "DEMO-RESERVE", "name": "SIMULATED budget reserve",
            "organization_id": line.organization_id, "category_id": reserve_category.id,
            "period_id": period["id"], "allocated_amount": 100000,
        })
        api.post("/budgets/reallocate", usernames[payer_role], {
            "from_line_id": reserve["id"], "to_line_id": line.id, "amount": 10000,
            "reason": "SIMULATED DEMO: fund the held sample claim",
        })
        act("release", "REGIONAL_FINANCE", comment="DEMO: allocation restored; rechecked same claim")
        snap("Hold released after funding", "REGIONAL_FINANCE", "Continue to payor",
             "An audited budget reallocation restores funds. Finance retries the same claim, not a duplicate.",
             "The claim is routed only after the budget check succeeds.")
    snap("Payor receives routed claim", payer_role, "Prepare payment batch",
         "Routing commits the budget and makes the claim READY. It does not transfer money.",
         "Services go to FHI360; new Payroll goes directly to its CSO, without the legacy FHI360 handoff.")
    batches = api.post("/batches", usernames[payer_role], {"route_code": route})
    batch = next(b for b in batches if any(l["claim_id"] == claim_id for l in api.get(f"/batches/{b['id']}", usernames[payer_role])["lines"]))
    batch_id = batch["id"]
    for fmt in ("csv", "xlsx"):
        result = api.call("GET", f"/batches/{batch_id}/export.{fmt}", usernames[payer_role])
        assert result.content
    snap("Payment batch exported", payer_role, "Export CSV / XLSX",
         "The immutable register is sent to the payor for external execution. Both export formats were checked.",
         "EXPORTED is not PAID. No bank or wallet integration is invoked.")
    amount = Decimal(str(api.get(f"/claims/{claim_id}", usernames[payer_role])["amount"]))
    api.post(f"/claims/{claim_id}/payments", usernames[payer_role], {
        "amount": str(amount / 2), "status": "PARTIAL",
        "payment_reference": f"SIMULATED-{scenario['id']}-PART",
        "payment_date": period["start_date"],
    })
    snap("Partial external payment recorded", payer_role, "Record remaining amount",
         "This is an explicitly simulated external-payment record, not an initiated transfer.",
         "PARTIALLY_RECORDED; the log must not be shown as paid.")
    api.post(f"/claims/{claim_id}/payments", usernames[payer_role], {
        "amount": str(amount / 2), "payment_reference": f"SIMULATED-{scenario['id']}-FINAL",
        "payment_date": period["start_date"],
    })
    snap("Payment awaiting evidence", payer_role, "Upload sample proof",
         "The full amount is recorded, but evidence is mandatory.",
         "PROOF_REQUIRED; full recorded amount alone is not enough.")
    api.call("POST", f"/claims/{claim_id}/proofs", usernames[payer_role],
             files={"file": ("DEMO-NOT-REAL-PAYMENT.pdf", sample_proof_pdf(), "application/pdf")})
    evidence = snap("Sample proof uploaded", payer_role, "Confirm paid",
                    "The valid sample PDF is prominently marked NOT PROOF OF A REAL PAYMENT.",
                    "Uploading evidence alone does not change PROOF_REQUIRED to PAID.")
    assert evidence["claim"]["payment_status"] == "PROOF_REQUIRED"
    api.post(f"/claims/{claim_id}/actions/confirm_paid", usernames[payer_role])
    paid = snap("Payment confirmed", payer_role, "Reconcile independently",
                "The recorded amount and required evidence now both exist.",
                "Claim payment status and provider work-log status are PAID.")
    assert paid["claim"]["payment_status"] == paid["work_log"]["status"] == "PAID"
    api.post(f"/claims/{claim_id}/actions/reconcile", reconciler,
             {"comment": "SIMULATED DEMO: independent check of sample payment and evidence"})
    snap("Independent reconciliation", payer_role, "View audit trail",
         "A different finance user reconciles the record. The payment recorder cannot reconcile their own payment.",
         "RECONCILED; all earlier actors and decisions remain in the claim audit.", username=reconciler)
    snap("Provider sees completed payment", "PROVIDER", "View own status",
         "The provider can see their own completed work and claim, without finance-only proof or payment controls.",
         "PAID work log and RECONCILED claim; no live financial records were changed.")
    return scenario
