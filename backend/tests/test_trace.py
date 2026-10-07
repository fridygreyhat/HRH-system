"""Claim lineage: every paid unit traces back to daily entries, the confirmed version and the approval chain."""
from sqlalchemy import text

from .conftest import approved_log, category_id


def test_trace_links_each_component_to_daily_entries_and_approvals(api, period, db):
    log = approved_log(api, "chw1", period)  # 2 days, clients_followed_up 5 per day
    claim = api.post("/claims", "csofin1", {"work_log_id": log["id"], "category_id": category_id(db, "C")})
    trace = api.get(f"/claims/{claim['id']}/trace", "csofin1")

    assert trace["basis"] == "WORK_LOG" and trace["work_log"]["confirmed_version"] == 1
    by_name = {c["component_name"]: c for c in trace["components"]}
    days = by_name["DEMO service days"]
    assert days["unit_type"] == "PER_DAY" and len(days["contributions"]) == 2 and days["reconciles"] is True
    reached = by_name["DEMO clients reached"]
    assert reached["measure_key"] == "clients_followed_up" and reached["measure_label_sw"]
    assert [c["value"] for c in reached["contributions"]] == [5, 5] and reached["traced_total"] == reached["units"] == 10
    assert reached["matches_confirmed_version"] is True and reached["rate_rule"]["status"] == "ACTIVE"
    assert reached["rate_rule"]["approved_by_name"] == "FHI360 Oversight"
    assert reached["contributions"][0]["evidence_text"] and reached["contributions"][0]["location_status"]
    assert trace["summary"]["all_reconcile"] is True and trace["summary"]["all_match_confirmed_version"] is True
    assert trace["summary"]["components_total"] == claim["amount"]

    chain = [(r["action"], r["actor_role"]) for r in trace["work_log_chain"]]
    assert chain == [("submit", "PROVIDER"), ("verify", "SUPERVISOR"), ("confirm_otp", "PROVIDER"), ("endorse", "TECHNICAL_OFFICER"), ("authorize", "RPM")]
    assert trace["claim_chain"][0]["action"] == "create"


def test_trace_respects_access_and_gps_rules(api, period, db):
    log = approved_log(api, "hcp1", period)
    claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "A")})
    finance = api.get(f"/claims/{claim['id']}/trace", "fhifin1")
    assert finance["summary"]["gps_visible"] is False
    assert all("gps_lat" not in c for comp in finance["components"] for c in comp["contributions"])
    own = api.get(f"/claims/{claim['id']}/trace", "hcp1")
    assert own["summary"]["gps_visible"] is True and own["payments"] == []  # payment records are finance-only
    oversight = api.get(f"/claims/{claim['id']}/trace", "oversight1")
    assert oversight["summary"]["gps_visible"] is False and oversight["proof_count"] is None
    for outsider in ("csofin1", "csofin3", "supervisor1", "chw1"):
        api.get(f"/claims/{claim['id']}/trace", outsider, expect=404)


def test_trace_of_claim_without_work_log_shows_declared_units(api, period, db):
    from backend.models import Staff

    chw = db.query(Staff).filter(Staff.verified_phone == "+255710000101").one()
    claim = api.post("/claims", "csofin1", {"category_id": category_id(db, "C"), "staff_id": chw.id, "period_id": period["id"],
                                             "evidence_text": "Outreach sessions", "declared_units": {"days": 3, "clients_followed_up": 7}})
    api.post(f"/claims/{claim['id']}/actions/verify_community", "verifier1")
    trace = api.get(f"/claims/{claim['id']}/trace", "csofin1")
    assert trace["basis"] == "DECLARED_UNITS" and trace["work_log"] is None
    assert trace["declared_units"] == {"days": 3, "clients_followed_up": 7}
    assert trace["community_verification"]["verified_by"] == "Community Verifier Gangilonga"
    assert all(c["reconciles"] is None and c["contributions"] == [] for c in trace["components"])


def test_trace_flags_values_changed_after_approval(api, period, db):
    log = approved_log(api, "chw1", period)
    claim = api.post("/claims", "csofin1", {"work_log_id": log["id"], "category_id": category_id(db, "C")})
    # Simulate a direct database edit that bypasses the API (which locks approved logs).
    db.execute(text("update work_log_measures set value = 50 where field_key = 'clients_followed_up' and entry_id in "
                    "(select id from work_log_entries where work_log_id = :w)"), {"w": log["id"]})
    db.commit()
    trace = api.get(f"/claims/{claim['id']}/trace", "csofin1")
    reached = next(c for c in trace["components"] if c["measure_key"] == "clients_followed_up")
    assert reached["reconciles"] is False and reached["traced_total"] == 100 and reached["units"] == 10
    assert reached["matches_confirmed_version"] is True  # the confirmed snapshot still shows what was approved
    assert trace["summary"]["all_reconcile"] is False
