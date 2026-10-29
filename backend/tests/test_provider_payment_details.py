"""Self-service payment profiles and channel-scoped finance reads/exports."""
import csv
import io
import json

import pytest

from .test_v22_finance import v22, priced_activity, entered_log, to_finance, route_log
from .test_direct_community_claims import community, verified

SAMPLE = {
    "bank_name": "Synthetic Test Bank",
    "bank_account_number": "0012345678",
    "bank_branch": "Synthetic Branch",
    "mobile_money_number": "+255700123456",
}


@pytest.fixture
def provider_profile(db):
    from backend.models import Staff, User
    from backend.services.provider_payment_details import FIELDS
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "chw1").one()
    fields = (*FIELDS, "payment_details_updated_at")
    before = {key: getattr(staff, key) for key in fields}
    yield staff.id
    db.expire_all()
    for key, value in before.items():
        setattr(staff, key, value)
    db.commit()


def test_provider_updates_both_channels_only_own_profile_and_audit_is_redacted(api, db, provider_profile):
    from backend.models import AuditEvent
    changed = api.put("/provider-details/me", "chw1", {**SAMPLE, "mobile_money_number": "0700123456"})
    assert changed == {"staff_id": provider_profile, **SAMPLE}
    assert api.get("/provider-details/me", "chw1") == changed
    assert api.put(f"/provider-details/update-details/{provider_profile}", "chw1", SAMPLE) == changed
    api.put(f"/provider-details/update-details/{provider_profile + 1}", "chw1", SAMPLE, expect=404)
    api.put("/provider-details/me", "fhifin1", SAMPLE, expect=403)
    api.put("/provider-details/me", "csofin1", SAMPLE, expect=403)
    api.put("/provider-details/me", "chw1", {**SAMPLE, "staff_id": provider_profile + 1}, expect=422)
    api.get(f"/provider-details/{provider_profile}", "hcp2", expect=403)
    event = db.query(AuditEvent).filter_by(action="update_payment_details", entity_id=str(provider_profile)).order_by(AuditEvent.id.desc()).first()
    encoded = json.dumps(event.after)
    assert "bank_account_number" in encoded
    assert SAMPLE["bank_account_number"] not in encoded and SAMPLE["mobile_money_number"] not in encoded


@pytest.mark.parametrize("change", [
    {"bank_account_number": "123"},
    {"bank_account_number": "=1+1"},
    {"mobile_money_number": "+254700123456"},
    {"bank_name": "Test bank", "bank_account_number": None, "bank_branch": None},
])
def test_invalid_payment_details_do_not_change_profile(api, provider_profile, change):
    initial = api.get("/provider-details/me", "chw1")
    api.put("/provider-details/me", "chw1", change, expect=422)
    assert api.get("/provider-details/me", "chw1") == initial


def test_explicit_clear_does_not_resurrect_legacy_mobile_account(api, provider_profile):
    api.put("/provider-details/me", "chw1", SAMPLE)
    cleared = api.put("/provider-details/me", "chw1", dict.fromkeys(SAMPLE))
    assert all(cleared[key] is None for key in SAMPLE)
    assert api.get("/provider-details/me", "chw1") == cleared


def payroll(api, db, period, v22):
    # A synthetic historical priced Payroll claim: new Payroll rates/claims
    # are retired, but existing bank-payment exports must stay readable.
    from decimal import Decimal
    from backend.models import BudgetLine, ClaimCategory, PaymentClaim, User, utcnow
    from backend.services import claims as claim_service
    from .conftest import category_id
    from .test_finance_missing_rates import unpriced_log
    log, _, assignment = unpriced_log(db, period, kind="PAYROLL")
    category = db.get(ClaimCategory, category_id(db, "B"))
    line = db.query(BudgetLine).filter_by(
        category_id=category.id, period_id=period["id"],
        organization_id=assignment.organization_id, region_id=assignment.region_id,
    ).one()
    maker = db.query(User).filter_by(username="fhifin1").one()
    snapshot = {"total": "1000", "currency": "TZS", "lines": [], "exceptions": []}
    log.status, log.routed_channel, log.approved_at = "ROUTED_CSO", "CSO", utcnow()
    log.finance_snapshot = snapshot
    claim = PaymentClaim(
        workflow_version=2, work_type="PAYROLL", work_log_id=log.id,
        staff_id=log.staff_id, period_id=log.period_id, assignment_id=assignment.id,
        category_id=category.id, funding_source_id=category.funding_source_id,
        budget_line_id=line.id,
        route_code="B", payor_org_id=assignment.organization_id,
        executor_org_id=assignment.organization_id, origin_channel="FACILITY",
        amount=Decimal("1000"), currency="TZS", calculation_snapshot=snapshot,
        created_by=maker.id, status=claim_service.APPROVED,
    )
    db.add(claim)
    db.flush()
    claim_service._commit_budget(db, maker, claim)
    claim.status = claim_service.READY
    db.commit()
    return api.get(f"/claims/{claim.id}", "csofin1")


def test_payroll_bank_only_export_scope_and_no_status_change(api, db, period, v22, provider_profile):
    from backend.models import PaymentClaim, BudgetLine
    api.put("/provider-details/me", "chw1", SAMPLE)
    claim = payroll(api, db, period, v22)
    assert claim["payment_recipient"]["payment_account"] == SAMPLE["bank_account_number"]
    assert claim["payment_recipient"]["bank_branch"] == SAMPLE["bank_branch"]
    assert "mobile_money_number" not in claim["payment_recipient"]
    visible = api.get(f"/provider-details/{provider_profile}", "csofin1")
    assert visible["bank_account_number"] == SAMPLE["bank_account_number"]
    staff = api.get(f"/staff/{provider_profile}", "csofin1")
    assert staff["bank_account_number"] == SAMPLE["bank_account_number"]
    # A provider-level view may legitimately include mobile details when this
    # same CSO has a separate assigned community claim from another period.
    api.get(f"/provider-details/{provider_profile}", "csofin3", expect=404)
    stored = db.get(PaymentClaim, claim["id"])
    budget = db.get(BudgetLine, stored.budget_line_id)
    before = stored.status, stored.payment_status, budget.committed_amount, budget.spent_amount
    query = f"/cso-finance/export-payroll?cso_id={claim['executor_org_id']}&period_id={period['id']}"
    for user in ("fhifin1", "chw1"):
        api.get(query, user, expect=403)
    api.get(query, "csofin3", expect=404)
    response = api.client.get(query, headers={"Authorization": f"Bearer {api.token('csofin1')}"})
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    row = next(row for row in rows if int(row["claim_id"]) == claim["id"])
    assert row["bank_account_number"] == SAMPLE["bank_account_number"]
    assert float(row["validated_amount"]) == float(claim["amount"])
    assert SAMPLE["mobile_money_number"] not in response.text
    db.expire_all()
    assert (stored.status, stored.payment_status, budget.committed_amount, budget.spent_amount) == before
    dashboard = api.get(f"/cso-finance/dashboard/{claim['executor_org_id']}", "csofin1")
    assert dashboard["pending_payroll_count"] >= 1
    assert dashboard["currencies"]
    api.get(f"/cso-finance/dashboard/{claim['executor_org_id']}", "csofin3", expect=404)
    # A prior partial payment followed by a failed attempt must not be paid in full again.
    api.post(f"/claims/{claim['id']}/payments", "csofin1", {
        "amount": 100, "payment_reference": "SYNTHETIC-PARTIAL-PROFILE",
        "payment_date": period["start_date"], "status": "PARTIAL",
    })
    response = api.client.get(query, headers={"Authorization": f"Bearer {api.token('csofin1')}"})
    if response.status_code == 200:
        exported_ids = [row["claim_id"] for row in csv.DictReader(io.StringIO(response.content.decode("utf-8-sig")))]
        assert str(claim["id"]) not in exported_ids
    else:
        assert response.status_code == 422


def test_missing_bank_branch_blocks_whole_payroll_export(api, db, period, v22, provider_profile):
    from backend.models import Staff
    api.put("/provider-details/me", "chw1", SAMPLE)
    claim = payroll(api, db, period, v22)
    db.expire_all()
    db.get(Staff, provider_profile).bank_branch = None
    db.commit()
    api.get(f"/cso-finance/export-payroll?cso_id={claim['executor_org_id']}&period_id={period['id']}",
            "csofin1", expect=422)


def test_fhi_services_get_mobile_only_including_existing_staff_screen(api, db, period, v22, provider_profile):
    api.put("/provider-details/me", "chw1", SAMPLE)
    from .test_finance_missing_rates import unpriced_log, rate_for
    log, entry, assignment = unpriced_log(db, period)
    rate_for(db, log, assignment, entry.activity_key, entry.entry_date, amount=500)
    approved = api.post(f"/worklogs/{log.id}/actions/authorize", "rpm1",
                        {"review_confirmed": True, "review_type": "SERVICES"})
    routed = route_log(api, db, v22, approved, "A")
    claim = api.get(f"/claims/{routed['claims'][0]['id']}", "fhifin1")
    assert claim["payment_recipient"]["payment_account"] == SAMPLE["mobile_money_number"]
    assert not claim["payment_recipient"]["bank_branch"]
    for path in (f"/staff/{provider_profile}", f"/provider-details/{provider_profile}"):
        result = api.get(path, "fhifin1")
        assert result["mobile_money_number"] == SAMPLE["mobile_money_number"]
        assert "bank_account_number" not in result and "bank_name" not in result and "bank_branch" not in result
        assert SAMPLE["bank_account_number"] not in json.dumps(result)
    from backend.models import AuditEvent
    assert db.query(AuditEvent).filter_by(action="view_payment_details", entity_id=str(provider_profile)).count() >= 1


def test_assigned_cso_community_exception_exposes_only_used_mobile_channel(api, db, community, provider_profile):
    api.put("/provider-details/me", "chw1", SAMPLE)
    claim = verified(api, community)
    api.post(f"/claims/{claim['id']}/actions/approve", "csofin1")
    allowed = api.get(f"/provider-details/{provider_profile}", "csofin1")
    assert allowed["mobile_money_number"] == SAMPLE["mobile_money_number"]
    # No payroll in this test's period is needed to grant community mobile access.
    api.get(f"/provider-details/{provider_profile}", "csofin3", expect=404)


def test_legacy_batch_download_redaction_preserves_snapshot():
    from types import SimpleNamespace
    from backend.services.provider_payment_details import redacted_batch_lines
    batch = SimpleNamespace(route_code="B", executor_org_id=12)
    line = {"payment_method": "BANK", "payment_account": SAMPLE["bank_account_number"],
            "payment_provider": SAMPLE["bank_name"], "amount": "100"}
    current = SimpleNamespace(roles={"FHI360_FINANCE"}, scope_values=lambda key: set())
    assert redacted_batch_lines(current, batch, [line])[0]["payment_account"] == ""
    assert line["payment_account"] == SAMPLE["bank_account_number"]
    current = SimpleNamespace(roles={"CSO_FINANCE"}, scope_values=lambda key: {12})
    assert redacted_batch_lines(current, batch, [line])[0]["payment_account"] == SAMPLE["bank_account_number"]
