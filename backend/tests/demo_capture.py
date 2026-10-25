"""Whitelisted projections of isolated test API responses, never real user data."""


def capture(api, scenario, *, title, role, actor, username, action, explanation, expected,
            log_id=None, claim_id=None, batch_id=None):
    log = api.get(f"/worklogs/{log_id}", username) if log_id else None
    claim = api.get(f"/claims/{claim_id}", username) if claim_id else None
    # Provider/RPM views must not include finance-only batch details.
    batch = api.get(f"/batches/{batch_id}", username) if batch_id and role in {"FHI360_FINANCE", "CSO_FINANCE", "OVERSIGHT"} else None
    financial = (log or {}).get("financial_preview") or {}
    snapshot = {
        "id": f"{scenario['id']}-{len(scenario['steps']) + 1}",
        "title": title, "role": role, "actor": actor, "action": action,
        "explanation": explanation, "expected": expected,
        "work_log": None, "claim": None, "batch": None,
    }
    if log:
        snapshot["work_log"] = {
            "id": log["id"], "status": log["status"], "work_type": log["work_type"],
            "period_label": log["period_label"], "total_hours": float(log["total_hours"]),
            "entry_count": log["entry_count"], "available_actions": log["available_actions"],
            "entries": [{
                "date": e["entry_date"], "activity": (e.get("activity_snapshot") or {}).get("label_en", e.get("activity_key") or "Recorded activity"),
                "hours": float(e["hours_worked"]),
                "measures": {
                    (f"Activity units {index + 1}" if key.startswith("activity_") else key): value
                    for index, (key, value) in enumerate(e["measures"].items())
                },
            } for e in log["entries"]],
            "financial_total": str(financial["total"]) if "total" in financial else None,
            "currency": financial.get("currency"),
        }
    if claim:
        snapshot["claim"] = {
            "id": claim["id"], "status": claim["status"], "payment_status": claim["payment_status"],
            "amount": str(claim["amount"]), "currency": claim["currency"], "amount_paid": str(claim["amount_paid"]),
            "category_name": claim["category_name"], "payor_name": claim["payor_name"],
            "executor_name": claim["executor_name"], "budget_line": (claim.get("budget_line") or {}).get("code"),
            "proof_count": len(claim["proofs"]), "available_actions": claim["available_actions"],
            "payment_actions": claim["payment_actions"],
            "components": [{"name": c["component_name"], "units": str(c["units"]), "rate": str(c["rate"]), "amount": str(c["amount"])} for c in claim["components"]],
            "audit": [{"action": a["action"], "role": a["actor_role"] or "SYSTEM", "status": a["new_status"]} for a in claim["audit"]],
        }
    if batch:
        snapshot["batch"] = {
            key: str(batch[key]) if key == "total_amount" else batch[key]
            for key in ("reference", "status", "line_count", "total_amount", "currency", "payor_name", "executor_name")
        }
    scenario["steps"].append(snapshot)
    return snapshot
