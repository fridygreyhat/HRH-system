from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal
import uuid

import pytest

from backend.models import ActivityRate, Cadre, PaymentClaim, Region, Staff, StaffAssignment, User, UserReviewCadre, WorkLog, WorkLogEntry
from backend.services.finance_gate import preview
from backend.services import claims
from .conftest import category_id
from .test_ctc_facility_approval import no_provider_sms
from .test_v22_finance import v22


def unpriced_log(db, period, provider="chw1", kind="SERVICES"):
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == provider).one()
    placement = db.query(StaffAssignment).filter_by(staff_id=staff.id).first()
    log = WorkLog(staff_id=staff.id, assignment_id=placement.id, cadre_id=staff.cadre_id,
                  period_id=period["id"], workflow_version=2, work_type=kind,
                  status="PENDING_RPM_AUTHORIZATION")
    db.add(log)
    db.flush()
    entry = WorkLogEntry(work_log_id=log.id, entry_date=date.fromisoformat(period["start_date"]),
                         hours_worked=8 if kind == "PAYROLL" else 2, evidence_text="Isolated pricing test",
                         activity_key=f"unpriced_test_{log.id}")
    entry.activity_snapshot = {
        "key": entry.activity_key, "label_en": "Unpriced test service",
        "label_sw": "Huduma ya majaribio", "item_type": kind, "form_mode": "SINGLE",
        "fields": [], "required_fields": [], "field_definitions": [], "rate_value": None,
        "currency": "TZS", "unit_type": "PER_DAY", "billable_field": None,
    }
    db.add(entry)
    db.commit()
    return log, entry, placement


def rate_for(db, log, placement, source_key, effective, amount=40000):
    row = ActivityRate(
        key="test_" + uuid.uuid4().hex, source_key=source_key,
        label_en="Approved test service", label_sw="Huduma ya majaribio",
        cadre_id=log.cadre_id, region_id=placement.region_id, item_type="SERVICES",
        form_mode="SINGLE", field_definitions=[], hours_input=True, rate_value=amount,
        currency="TZS", unit_type="PER_DAY", is_active=True, effective_start_date=effective,
        created_by=db.query(User).filter_by(username="admin").one().id,
    )
    db.add(row)
    db.commit()
    return row


@pytest.mark.parametrize("provider", ["chw1", "hcp1", "clerk1"])
@pytest.mark.parametrize("kind", ["SERVICES", "PAYROLL"])
def test_rm_approves_unpriced_work_but_finance_cannot_prepare_payment(api, db, period, v22, provider, kind):
    log, _, _ = unpriced_log(db, period, provider, kind)
    result = api.post(f"/worklogs/{log.id}/actions/authorize", "rpm1", {
        "review_confirmed": True, "review_type": kind,
    })
    assert result["status"] == ("APPROVED" if kind == "PAYROLL" else "PENDING_FINANCE_REVIEW")
    assert result["approved_at"]
    assert result["claims"] == []
    # Scope must still be explicit even though Payroll itself needs no finance action.
    finance = db.query(User).filter_by(username=v22["finance"]).one()
    if not db.get(UserReviewCadre, (finance.id, log.cadre_id)):
        assert log.id not in {item["id"] for item in api.get(f"/worklogs?queue=true&work_type={kind}", v22["finance"])}
        db.add(UserReviewCadre(user_id=finance.id, cadre_id=log.cadre_id))
        db.commit()
    if kind == "PAYROLL":
        assert result["financial_preview"] is None
        assert "hold" not in result["available_actions"]
        assert log.id not in {item["id"] for item in api.get("/worklogs?queue=true&work_type=PAYROLL", v22["finance"])}
        api.post(f"/worklogs/{log.id}/actions/finance_review", v22["finance"], {
            "review_confirmed": True, "review_type": kind,
        }, expect=403)
        return
    queue = api.get(f"/worklogs?queue=true&work_type={kind}", v22["finance"])
    assert log.id in {item["id"] for item in queue}
    wrong = "PAYROLL" if kind == "SERVICES" else "SERVICES"
    assert log.id not in {item["id"] for item in api.get(f"/worklogs?queue=true&work_type={wrong}", v22["finance"])}
    error = api.post(f"/worklogs/{log.id}/actions/finance_review", v22["finance"], {
        "review_confirmed": True, "review_type": kind,
        "category_id": category_id(db, "A" if kind == "SERVICES" else "B"),
    }, expect=422)
    assert "amounts/rates are missing" in error["detail"]
    assert api.get(f"/worklogs/{log.id}", v22["finance"])["claims"] == []


def test_work_date_rates_fill_only_missing_terms_and_pay_highest_once(api, db, period, v22):
    log, entry, placement = unpriced_log(db, period)
    original = deepcopy(entry.activity_snapshot)
    late = rate_for(db, log, placement, entry.activity_key, entry.entry_date + timedelta(days=1))
    assert preview(db, log)["exceptions"]  # Future rates cannot pay earlier dates.
    late.effective_start_date = entry.entry_date
    db.commit()
    first = preview(db, log)
    assert first["exceptions"] == [] and Decimal(first["total"]) == 40000
    assert first["lines"][0]["activity_rate_id"] == late.id
    db.refresh(entry)
    assert entry.activity_snapshot == original  # No clinical snapshot rewrite.

    extra = {**original, "key": "extra_" + uuid.uuid4().hex, "label_en": "Second test service"}
    entry.activity_snapshot = {**original, "additional_services": [{"activity": extra, "measures": {}}]}
    db.commit()
    assert preview(db, log)["exceptions"]  # No partial payment if an extra is unpriced.
    second = rate_for(db, log, placement, extra["key"], entry.entry_date, 50000)
    priced = preview(db, log)
    assert priced["exceptions"] == []
    assert len(priced["lines"]) == 1 and Decimal(priced["total"]) == 50000
    assert priced["lines"][0]["activity_rate_id"] == second.id


def test_already_priced_and_frozen_finance_claims_are_not_repriced(api, db, period, v22):
    log, entry, placement = unpriced_log(db, period)
    rate = rate_for(db, log, placement, entry.activity_key, entry.entry_date)
    saved = preview(db, log)
    owner = db.query(User).filter_by(username="admin").one()
    claim = PaymentClaim(workflow_version=2, work_type="SERVICES", work_log_id=log.id,
                         staff_id=log.staff_id, period_id=log.period_id, assignment_id=log.assignment_id,
                         category_id=category_id(db, "A"),
                         amount=Decimal(saved["total"]), currency="TZS", status=claims.READY,
                         payment_status="PAID", calculation_snapshot=deepcopy(saved), created_by=owner.id)
    db.add(claim)
    rate.rate_value = 90000
    db.commit()
    assert preview(db, log) == saved
    assert claim.amount == Decimal("40000")

    other_log, other_entry, _ = unpriced_log(db, period, provider="hcp1")
    other_entry.activity_snapshot = {**other_entry.activity_snapshot, "rate_value": "30000", "unit_type": "PER_DAY"}
    db.commit()
    assert Decimal(preview(db, other_log)["total"]) == 30000  # Saved positive terms are also retained.
    assert preview(db, log) == saved  # The completed payment was never cancelled or modified.


def test_ambiguous_rates_do_not_choose_an_arbitrary_amount(api, db, period, v22):
    log, entry, placement = unpriced_log(db, period)
    rate_for(db, log, placement, entry.activity_key, entry.entry_date, 40000)
    rate_for(db, log, placement, entry.activity_key, entry.entry_date, 60000)
    result = preview(db, log)
    assert any("conflicting approved daily amounts" in message for message in result["exceptions"])
    assert not result["lines"]


@pytest.mark.parametrize("wrong_dimension", ["region", "cadre"])
def test_missing_amount_is_not_filled_from_another_region_or_cadre(api, db, period, v22, wrong_dimension):
    log, entry, placement = unpriced_log(db, period)
    row = rate_for(db, log, placement, entry.activity_key, entry.entry_date)
    if wrong_dimension == "region":
        row.region_id = db.query(Region.id).filter(Region.id != placement.region_id).first()[0]
    else:
        row.cadre_id = db.query(Cadre.id).filter(Cadre.id != log.cadre_id).first()[0]
    db.commit()
    result = preview(db, log)
    assert result["exceptions"] and not result["lines"]
