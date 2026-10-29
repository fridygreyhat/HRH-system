"""Configuration-only transfer is reviewed, scoped to Super Admin and missing-only."""
import copy
from fastapi.encoders import jsonable_encoder

from backend.models import (
    AuditEvent, Cadre, FundingSource, Organization, PaymentClaim, PaymentRecord,
    Role, Staff, StaffAssignment, User, UserReviewCadre, UserRole, WorkLog,
)
from backend.services.setup_transfer import user_data

PREFIX = "/admin/setup-transfer"


def record(kind, data, key="test-record"):
    return {"id": key, "kind": kind, "label": key, "data": jsonable_encoder(data)}


def document(*records):
    return {"version": 1, "records": list(records), "warnings": []}


def review(api, doc):
    return api.post(PREFIX + "/review", "admin", {"document": doc})


def apply(api, doc, reviewed, selected=None, expect=None, **extra):
    return api.post(PREFIX + "/apply", "admin", {
        "document": doc, "selected_ids": selected or [r["id"] for r in doc["records"]],
        "review_token": reviewed["review_token"], "reason": "Restore missing live setup only",
        "confirmation": "APPLY MISSING SETUP", **extra,
    }, expect=expect)


def test_export_excludes_credentials_payments_and_admins(api, db):
    exported = api.get(PREFIX + "/export", "admin")
    assert exported["version"] == 1 and exported["records"]
    assert all(r["kind"] in {"organization", "funding_source", "facility", "pay_period", "user_setup", "service_rate"}
               for r in exported["records"])
    assert not any(r["kind"] == "user_setup" and r["data"]["username"] == "admin" for r in exported["records"])
    forbidden = {"hashed_password", "password", "access_token", "bank_account_number", "payment_account",
                 "bank_branch", "mobile_money_number", "finance_snapshot", "beneficiary_snapshot"}

    def check(value):
        if isinstance(value, dict):
            assert not forbidden.intersection(value)
            for item in value.values():
                check(item)
        elif isinstance(value, list):
            for item in value:
                check(item)
    check(exported)
    api.get(PREFIX + "/export", "chw1", expect=403)
    api.get(PREFIX + "/export", "fhifin1", expect=403)
    api.post(PREFIX + "/review", "fhifin1", {"document": exported}, expect=403)
    result = review(api, exported)
    assert result["items"]
    assert result["warnings"]


def test_selected_missing_only_is_audited_and_does_not_copy_work(api, db):
    doc = document(
        record("funding_source", {"code": "SETUP_X", "name": "Setup source X"}, "source-x"),
        record("funding_source", {"code": "SETUP_Y", "name": "Setup source Y"}, "source-y"),
    )
    counts = {model: db.query(model).count() for model in (WorkLog, PaymentClaim, PaymentRecord)}
    reviewed = review(api, doc)
    assert {r["state"] for r in reviewed["items"]} == {"MISSING"}
    result = apply(api, doc, reviewed, ["source-x"])
    assert result["applied"] == 1
    assert db.query(FundingSource).filter_by(code="SETUP_X").count() == 1
    assert db.query(FundingSource).filter_by(code="SETUP_Y").count() == 0
    assert counts == {model: db.query(model).count() for model in counts}
    event = db.query(AuditEvent).filter_by(entity_type="setup_transfer", entity_id="source-x").one()
    assert event.reason == "Restore missing live setup only"
    apply(api, doc, reviewed, ["source-x"], expect=409)
    reviewed = review(api, doc)
    assert next(r for r in reviewed["items"] if r["id"] == "source-x")["state"] == "EXISTS"
    apply(api, doc, reviewed, ["source-x"], expect=409)


def test_changed_document_or_target_requires_fresh_review(api, db):
    doc = document(record("funding_source", {"code": "STALE_X", "name": "Stale source X"}))
    reviewed = review(api, doc)
    changed = copy.deepcopy(doc)
    changed["records"][0]["data"]["name"] = "Changed source"
    apply(api, changed, reviewed, expect=409)
    db.add(FundingSource(code="OTHER_CHANGE", name="Other setup change"))
    db.commit()
    apply(api, doc, reviewed, expect=409)
    assert not db.query(FundingSource).filter_by(code="STALE_X").first()
    apply(api, doc, review(api, doc))
    assert db.query(FundingSource).filter_by(code="STALE_X").count() == 1


def test_roles_and_staff_dependencies_are_atomic_and_passwords_unchanged(api, db):
    finance = db.query(User).filter_by(username="fhifin1").one()
    before_password, before_active = finance.hashed_password, finance.is_active
    data = user_data(db, finance)
    data["roles"].append("REGIONAL_FINANCE")
    data["review_cadres"] = ["CHW", "HCP", "DATA_CLERK"]
    data["scopes"].append({"region": None, "organization": "Transfer dependency org", "facility": None})
    doc = document(
        record("funding_source", {"code": "ROLLBACK_SETUP", "name": "Atomic rollback source"}, "rollback-source"),
        record("organization", {"name": "Transfer dependency org", "code": "TRANSFER_DEP", "type": "CSO"}, "dependency-org"),
        record("user_setup", data, "finance-setup"),
    )
    reviewed = review(api, doc)
    assert all(r["state"] == "MISSING" for r in reviewed["items"])
    apply(api, doc, reviewed, ["rollback-source", "finance-setup"], expect=409)
    assert not db.query(FundingSource).filter_by(code="ROLLBACK_SETUP").first()
    assert not db.query(Organization).filter_by(code="TRANSFER_DEP").first()
    result = apply(api, doc, review(api, doc))
    assert result["applied"] == 3
    db.expire_all()
    assert finance.hashed_password == before_password and finance.is_active == before_active
    assert db.get(UserRole, (finance.id, db.query(Role).filter_by(name="REGIONAL_FINANCE").one().id))
    assert db.query(UserReviewCadre).filter_by(user_id=finance.id).count() >= 3


def test_new_provider_created_inactive_with_linked_staff_and_no_known_password(api, db):
    provider = db.query(User).filter_by(username="hcp1").one()
    data = user_data(db, provider)
    data.update(username="transfer.newprovider", full_name="Transfer New Provider", phone="+255799987321")
    data["staff"]["first_name"] = "Transfer"
    data["staff"]["last_name"] = "Provider"
    doc = document(record("user_setup", data, "new-provider"))
    assert apply(api, doc, review(api, doc))["applied"] == 1
    created = db.query(User).filter_by(username="transfer.newprovider").one()
    assert not created.is_active and created.must_change_password
    assert created.hashed_password != provider.hashed_password
    staff = db.query(Staff).filter_by(user_id=created.id).one()
    assert db.query(StaffAssignment).filter_by(staff_id=staff.id).count() == len(data["staff"]["assignments"])
    assert review(api, doc)["items"][0]["state"] == "EXISTS"


def test_conflicts_never_overwrite_existing_placements_or_rates(api, db):
    provider = db.query(User).filter_by(username="hcp1").one()
    data = user_data(db, provider)
    data["staff"]["assignments"][0]["start_date"] = "2001-01-01"
    doc = document(record("user_setup", data))
    reviewed = review(api, doc)
    assert reviewed["items"][0]["state"] == "CONFLICT"
    apply(api, doc, reviewed, expect=409)
    source = db.query(FundingSource).first()
    if source:
        d = document(record("funding_source", {"code": source.code, "name": "Conflicting name"}))
        assert review(api, d)["items"][0]["state"] == "CONFLICT"
        assert db.get(FundingSource, source.id).name != "Conflicting name"


def test_document_forbids_admin_roles_passwords_financial_data_and_bad_periods(api, client, db):
    provider = db.query(User).filter_by(username="hcp1").one()
    original = user_data(db, provider)
    for key, value in [("roles", ["SUPER_ADMIN"]), ("password", "must-never-be-imported"),
                       ("bank_account_number", "must-never-be-imported")]:
        data = copy.deepcopy(original)
        data[key] = value
        api.post(PREFIX + "/review", "admin", {"document": document(record("user_setup", data))}, expect=422)
    bad_period = document(record("pay_period", {
        "region": None, "start_date": "0943-01-01", "end_date": "2026-10-31",
        "period_label": "Invalid", "status": "OPEN",
    }))
    api.post(PREFIX + "/review", "admin", {"document": bad_period}, expect=422)
    duplicated = document(record("funding_source", {"code": "DUP", "name": "Duplicate"}))
    duplicated["records"].append(duplicated["records"][0])
    api.post(PREFIX + "/review", "admin", {"document": duplicated}, expect=422)
    # The body is bounded before parsing or database work, even unauthenticated.
    response = client.post(PREFIX + "/review", content=b" " * (2 * 1024 * 1024 + 1),
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413
