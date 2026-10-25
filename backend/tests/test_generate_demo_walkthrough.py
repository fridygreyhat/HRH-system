"""Opt-in generation: run scripts/generate_demo_walkthrough.py, not on live DB."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

from .conftest import make_period, PASSWORD
from .demo_scenarios import new_scenario
from .demo_legacy_scenarios import legacy_scenario

pytestmark = pytest.mark.skipif(not os.getenv("HRH_DEMO_EXPORT"), reason="Explicit isolated-demo generation only")


def test_generate_isolated_replays(api, db, monkeypatch):
    from backend.core import config, workflow_policy
    from backend.core.security import hash_password
    from backend.models import (
        User, UserRole, UserScope, UserReviewCadre, Role, Cadre, Region,
        Staff, StaffAssignment, Organization, BudgetLine,
    )
    assert os.environ["HRH_TEST_DATABASE"].startswith("hrh_demo_"), "Refuse demo generation outside isolated DB"
    assert config.SMS_GATEWAY_TYPE == "mock" and config.EXPOSE_DEV_OTP
    monkeypatch.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 2)
    roles = {r.name: r.id for r in db.query(Role)}
    cadres = {c.code: c.id for c in db.query(Cadre)}
    regions = {r.name: r.id for r in db.query(Region).filter(Region.name.in_(["Iringa", "Njombe"]))}
    sequence = 300

    def user(name, role, scopes, cadre_codes=()):
        nonlocal sequence
        sequence += 1
        u = User(username=name, full_name="DEMO " + name.removeprefix("demo_").replace("_", " ").title(),
                 phone=f"+255710000{sequence:03}", hashed_password=hash_password(PASSWORD), must_change_password=False)
        db.add(u); db.flush()
        db.add(UserRole(user_id=u.id, role_id=roles[role]))
        for scope in scopes:
            db.add(UserScope(user_id=u.id, **scope))
        for code in cadre_codes:
            db.add(UserReviewCadre(user_id=u.id, cadre_id=cadres[code]))
        return u

    nj_staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "hcp2").one()
    nj_assignment = db.query(StaffAssignment).filter_by(staff_id=nj_staff.id).one()
    for code, username in (("CHW", "demo_chw_njombe"), ("DATA_CLERK", "demo_clerk_njombe")):
        u = user(username, "PROVIDER", [])
        staff = Staff(user_id=u.id, cadre_id=cadres[code], first_name="DEMO", last_name=f"{code} Njombe",
                      verified_phone=u.phone, enrollment_source="MANUAL", employment_start_date=nj_staff.employment_start_date,
                      payment_method="MOBILE_WALLET", payment_provider="DEMO Wallet", payment_account=u.phone)
        db.add(staff); db.flush()
        db.add(StaffAssignment(staff_id=staff.id, start_date=nj_assignment.start_date,
                               region_id=nj_assignment.region_id, district_id=nj_assignment.district_id,
                               ward_id=nj_assignment.ward_id, facility_id=nj_assignment.facility_id,
                               organization_id=nj_assignment.organization_id, section="CTC"))
    ctc = user("demo_ctc_njombe", "SUPERVISOR", [{"facility_id": nj_assignment.facility_id}])
    db.add(UserRole(user_id=ctc.id, role_id=roles["FACILITY_IN_CHARGE"]))
    for code in cadres:
        user("demo_technical_" + code.lower(), "TECHNICAL_OFFICER",
             [{"region_id": rid} for rid in regions.values()], [code])
    for name, rid in regions.items():
        user("demo_regional_" + name.lower(), "REGIONAL_FINANCE", [{"region_id": rid}], list(cadres))
    user("demo_cso_njombe_review", "CSO_FINANCE",
         [{"organization_id": nj_assignment.organization_id}, {"region_id": regions["Njombe"]}], list(cadres))
    # Channel-finance roles keep explicit region/cadre scope. RPM needs no cadre grant.
    for name in ("fhifin1", "fhifin2", "csofin1", "csofin2", "csofin3"):
        u = db.query(User).filter_by(username=name).one()
        for rid in regions.values():
            db.add(UserScope(user_id=u.id, region_id=rid))
        for cid in cadres.values():
            db.add(UserReviewCadre(user_id=u.id, cadre_id=cid))
    db.commit()
    providers = []
    for name in ("chw1", "clerk1", "hcp1", "demo_chw_njombe", "demo_clerk_njombe", "hcp2"):
        staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == name).one()
        assignment = db.query(StaffAssignment).filter_by(staff_id=staff.id).one()
        providers.append({
            "username": name, "cadre": next(c for c, cid in cadres.items() if cid == staff.cadre_id),
            "cadre_id": staff.cadre_id, "region_id": assignment.region_id,
            "region": next(r for r, rid in regions.items() if rid == assignment.region_id),
        })
    scenarios = []
    period = make_period(api, db)
    for provider in providers:
        for kind in ("SERVICES", "PAYROLL"):
            scenarios.append(new_scenario(api, db, period, provider, kind))
    scenarios.append(new_scenario(api, db, make_period(api, db), providers[0], "SERVICES", "return"))
    held_period = make_period(api, db, {("DEMO-A-01", "FHI360"): 100})
    scenarios.append(new_scenario(api, db, held_period, providers[0], "SERVICES", "budget_hold"))
    with monkeypatch.context() as legacy:
        legacy.setattr(workflow_policy, "NEW_RECORD_WORKFLOW_VERSION", 1)
        for route in ("B", "C"):
            scenarios.append(legacy_scenario(api, db, make_period(api, db), route))
    assert len(scenarios) == 16
    assert all(s["steps"][-1]["claim"]["payment_status"] == "RECONCILED" for s in scenarios)
    assert all(s["steps"][-1]["work_log"]["status"] == "PAID" for s in scenarios if s["work_type"] != "LEGACY")
    assert {s["route"] for s in scenarios} == {"A", "B", "C"}
    result = {
        "schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(), "simulated": True,
        "summary": {"scenario_count": len(scenarios), "provider_count": len(providers),
                    "step_count": sum(len(s["steps"]) for s in scenarios)},
        "checks": [
            {"label": "Isolated records", "passed": True, "detail": "Generated only in a disposable test database; existing application data is untouched."},
            {"label": "All provider combinations", "passed": True, "detail": "CHW, Data Clerk and HCP in Iringa and Njombe; Services and Payroll for each."},
            {"label": "Real approval APIs exercised", "passed": True, "detail": "CTC, version-bound OTP, HCP facility endorsement, technical, RPM, Finance review and explicit payor routing."},
            {"label": "All payment routes", "passed": True, "detail": "Services/FHI360, direct CSO payroll, legacy Route B handoff and community Route C are kept distinct."},
            {"label": "Payment controls", "passed": True, "detail": "Partial payment is not paid; full payment needs evidence and explicit confirmation; reconciliation uses a different person."},
            {"label": "Exceptions", "passed": True, "detail": "Return/correction and insufficient-budget hold/reallocation/release both complete successfully."},
            {"label": "Exports and proof", "passed": True, "detail": "CSV and XLSX exports were requested; the uploaded valid sample PDF states NOT PROOF OF A REAL PAYMENT."},
            {"label": "No real SMS or transfers", "passed": True, "detail": "Mock SMS exists only inside generation. Production SMS configuration and account permissions are not changed."},
        ],
        "scenarios": scenarios,
    }
    # Whitelisted capture excludes OTPs, tokens, credentials, contacts and accounts.
    serialized = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    for forbidden in ('"dev_otp"', '"access_token"', '"hashed_password"', '"password"', '"payment_account"', '"destination_phone"'):
        assert forbidden not in serialized
    target = Path(os.environ["HRH_DEMO_EXPORT"])
    target.write_text(serialized + "\n", encoding="utf-8")
    print(f"Generated {len(scenarios)} isolated scenarios and {result['summary']['step_count']} role snapshots.")
