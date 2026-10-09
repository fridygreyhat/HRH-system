"""Acceptance criteria 1–7, 20–21: forms, approval order, scope, returns, locking, GPS, OTP, audit."""
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from .conftest import ENTRY, approved_log, draft_log, submit_and_verify


# 1. Cadre forms, valid dates, server totals
def test_each_cadre_gets_its_supplied_form(api):
    fields = {c["code"]: [f["key"] for f in c["fields"]] for c in api.get("/admin/cadres", "chw1")}
    assert len(fields["CHW"]) == 5 and "clients_returned_to_care" in fields["CHW"]
    assert fields["DATA_CLERK"][-1] == "ctc_hts_dataset_uploaded"
    assert len(fields["HCP"]) == 13 and "weekend_clinic_attended" in fields["HCP"]
    chw = api.get("/auth/me", "chw1")["cadre"]
    assert chw["hours_mode"] == "DIRECT" and chw["fields"][0]["label_sw"].startswith("Idadi ya Wateja")


def test_dates_fields_and_totals_are_validated_server_side(api, period):
    log = api.post("/worklogs", "clerk1", {"period_id": period["id"]})
    start = date.fromisoformat(period["start_date"])
    path = f"/worklogs/{log['id']}/entries"
    good = ENTRY["DATA_CLERK"](start)
    api.put(f"{path}/{start - timedelta(days=1)}", "clerk1", good, expect=422)  # outside period
    api.call("PUT", f"{path}/{start.year}-02-30", "clerk1", json=good, expect=422)  # nonexistent date
    api.put(f"{path}/{start}", "clerk1", {**good, "measures": {"clients_tested_hiv": 3}}, expect=422)  # HCP field on clerk form
    api.put(f"{path}/{start}", "clerk1", {**good, "measures": {"ctc_hts_dataset_uploaded": 3}}, expect=422)  # boolean field
    api.put(f"{path}/{start}", "clerk1", {**good, "end_time": "07:00"}, expect=422)  # end before start
    api.put(f"{path}/{start}", "clerk1", {**good, "evidence_text": "Client CTC 1234567890 registered"}, expect=422)  # identifier
    log = api.put(f"{path}/{start}", "clerk1", good)
    log = api.put(f"{path}/{start + timedelta(days=1)}", "clerk1", {**good, "start_time": "08:00", "end_time": "12:30"})
    assert [e["hours_worked"] for e in log["entries"]] == [8.0, 4.5]  # hours computed by the server
    assert log["totals"]["hours"] == 12.5 and log["totals"]["days"] == 2
    assert log["totals"]["measures"]["hts_clients_registered"] == 24 and log["totals"]["measures"]["ctc_hts_dataset_uploaded"] == 2
    current = api.get("/admin/pay-periods", "chw1")
    this_month = [p for p in current if date.fromisoformat(p["start_date"]) <= date.today() <= date.fromisoformat(p["end_date"])][0]
    future_log = api.post("/worklogs", "clerk1", {"period_id": this_month["id"]})
    api.put(f"/worklogs/{future_log['id']}/entries/{date.today() + timedelta(days=2)}", "clerk1", good, expect=422)  # future


def test_chw_records_hours_directly(api, period):
    log = api.post("/worklogs", "chw1", {"period_id": period["id"]})
    start = period["start_date"]
    api.put(f"/worklogs/{log['id']}/entries/{start}", "chw1", {"evidence_text": "Home visits", "start_time": "08:00", "end_time": "09:00"}, expect=422)
    log = api.put(f"/worklogs/{log['id']}/entries/{start}", "chw1", ENTRY["CHW"](start))
    assert log["entries"][0]["hours_worked"] == 8.5


# 2–3. Same ordered pipeline for every cadre, no bypass, scope enforced
@pytest.mark.parametrize("provider", ["chw1", "clerk1", "hcp1"])
def test_every_cadre_follows_the_same_pipeline(api, period, provider):
    log = draft_log(api, provider, period)
    api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": False}, expect=422)  # attestation required
    log = api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": True})
    assert log["status"] == "PENDING_CTC_VERIFICATION" and log["attested_at"]
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", expect=409)  # no skipping CTC
    api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", expect=409)
    api.post(f"/worklogs/{log['id']}/actions/verify", provider, expect=403)  # no self-verification
    log = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {"expected_version": log["version"]})
    assert log["status"] == "PENDING_PROVIDER_OTP_CONFIRMATION" and log["version"] == 1
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", expect=409)  # OTP first
    log = api.post(f"/worklogs/{log['id']}/otp/confirm", provider, {"code": log["otp"]["dev_otp"]})
    assert log["status"] == "PENDING_TECHNICAL_REVIEW" and log["confirmed_version"] == 1
    api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", expect=409)  # RPM cannot act before technical endorsement
    if provider == "hcp1":  # the HCP form requires the Facility In-Charge endorsement
        api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", expect=409)
        api.post(f"/worklogs/{log['id']}/actions/facility_endorse", "facilityic1", {})
    log = api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1")
    assert log["status"] == "PENDING_RPM_AUTHORIZATION"
    log = api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1")
    assert log["status"] == "APPROVED" and log["approved_at"]
    assert [a["action"] for a in log["audit"] if a["action"] not in ("opened", "edit_entry")] == (
        ["create", "submit", "verify", "confirm_otp"] + (["facility_endorse"] if provider == "hcp1" else []) + ["endorse", "authorize"]
    )


def test_reviewers_only_see_assigned_work(api, period):
    log = draft_log(api, "hcp2", period)
    api.post(f"/worklogs/{log['id']}/actions/submit", "hcp2", {"attest": True})
    for outsider in ("supervisor1", "tofficer1", "rpm1", "facilityic1", "csofin1"):
        api.get(f"/worklogs/{log['id']}", outsider, expect=404)
        assert log["id"] not in [l["id"] for l in api.get("/worklogs?queue=true", outsider)]
    api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", expect=404)
    api.get(f"/worklogs/{log['id']}", "rpm2")  # Njombe RPM can see it
    api.get(f"/worklogs/{log['id']}", "chw1", expect=404)  # other providers cannot
    assert api.get(f"/worklogs/{log['id']}", "oversight1")["available_actions"] == []  # oversight is read-only


# 4–5. Returns need reasons, restart the chain; verified versions are locked
def test_return_requires_reason_restarts_chain_and_notifies(api, period, db):
    log = submit_and_verify(api, "chw1", period)
    api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})
    api.post(f"/worklogs/{log['id']}/actions/return", "tofficer1", {"comment": ""}, expect=422)
    flags = [{"entry_date": period["start_date"], "field": "clients_followed_up", "note": "Count does not match register"}]
    log = api.post(f"/worklogs/{log['id']}/actions/return", "tofficer1", {"comment": "Check follow-up count", "flags": flags})
    assert log["status"] == "RETURNED_TO_PROVIDER"
    assert log["audit"][-1]["details"]["flags"] == flags
    outbox = db.execute(text("select event_name, related_status from sms_outbox where related_id = :id and event_name = 'WORKLOG_RETURNED'"), {"id": log["id"]}).all()
    assert outbox == [("WORKLOG_RETURNED", "RETURNED_TO_PROVIDER")]

    log = api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", {**ENTRY["CHW"](None), "measures": {"clients_followed_up": 4}})
    log = api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    assert log["status"] == "PENDING_CTC_VERIFICATION"  # every downstream decision is made again
    log = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {"expected_version": 1})
    assert log["version"] == 2
    snapshot = api.get(f"/worklogs/{log['id']}/versions/2", "chw1")["snapshot"]
    assert snapshot["entries"][0]["measures"]["clients_followed_up"] == "4.00"


def test_return_to_previous_reviewer(api, period):
    log = submit_and_verify(api, "clerk1", period)
    api.post(f"/worklogs/{log['id']}/otp/confirm", "clerk1", {"code": log["otp"]["dev_otp"]})
    log = api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1")
    log = api.post(f"/worklogs/{log['id']}/actions/return_to_reviewer", "rpm1", {"comment": "Please recheck data quality"})
    assert log["status"] == "PENDING_TECHNICAL_REVIEW"
    log = api.post(f"/worklogs/{log['id']}/actions/return_to_reviewer", "tofficer1", {"comment": "Re-verify attendance"})
    assert log["status"] == "PENDING_CTC_VERIFICATION"


def test_verified_version_is_locked_and_stale_decisions_rejected(api, period):
    log = submit_and_verify(api, "chw1", period)
    api.put(f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", ENTRY["CHW"](None), expect=409)
    api.call("DELETE", f"/worklogs/{log['id']}/entries/{period['start_date']}", "chw1", expect=409)
    api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", {"expected_version": 0}, expect=409)  # stale view


def test_reopen_after_approval_requires_reason_and_no_live_claims(api, period, db):
    from .conftest import category_id

    log = approved_log(api, "chw1", period)
    claim = api.post("/claims", "fhifin1", {"work_log_id": log["id"], "category_id": category_id(db, "A")})
    api.post(f"/worklogs/{log['id']}/actions/reopen", "rpm1", {"comment": "Correction"}, expect=409)
    api.post(f"/claims/{claim['id']}/actions/cancel", "fhifin1", {"comment": "Log being corrected"})
    api.post(f"/worklogs/{log['id']}/actions/reopen", "rpm1", {}, expect=422)
    log = api.post(f"/worklogs/{log['id']}/actions/reopen", "rpm1", {"comment": "Correction requested by provider"})
    assert log["status"] == "RETURNED_TO_PROVIDER" and log["can_edit"] is False  # rpm view
    assert api.get(f"/worklogs/{log['id']}", "chw1")["can_edit"] is True


# 6. GPS
def test_gps_is_evidence_for_review_not_an_automatic_rejection(api, period, db):
    far = {"gps_lat": -6.80, "gps_lon": 39.28}
    chw = api.post("/worklogs", "chw1", {"period_id": period["id"]})
    chw = api.put(f"/worklogs/{chw['id']}/entries/{period['start_date']}", "chw1", {**ENTRY["CHW"](None), **far})
    assert chw["entries"][0]["location_status"] == "COMMUNITY_REVIEW" and not chw["entries"][0]["location_exception"]
    hcp = api.post("/worklogs", "hcp1", {"period_id": period["id"]})
    hcp = api.put(f"/worklogs/{hcp['id']}/entries/{period['start_date']}", "hcp1", {**ENTRY["HCP"](None), **far})
    assert hcp["entries"][0]["location_status"] == "OUTSIDE_GEOFENCE" and hcp["location_exception_count"] == 1
    near = api.put(f"/worklogs/{hcp['id']}/entries/{date.fromisoformat(period['start_date']) + timedelta(days=1)}", "hcp1",
                   {**ENTRY["HCP"](None), "gps_lat": -7.7701, "gps_lon": 35.6901})
    assert near["entries"][1]["location_status"] == "WITHIN_GEOFENCE"
    api.post(f"/worklogs/{hcp['id']}/actions/submit", "hcp1", {"attest": True})
    assert "verify" in api.get(f"/worklogs/{hcp['id']}", "supervisor1")["available_actions"]  # still verifiable
    assert "gps_lat" in api.get(f"/worklogs/{hcp['id']}", "supervisor1")["entries"][0]
    assert "gps_lat" not in api.get(f"/worklogs/{hcp['id']}", "rpm1")["entries"][0]
    assert "gps_lat" not in api.get(f"/worklogs/{hcp['id']}", "oversight1")["entries"][0]

    api.put("/admin/settings/gps_capture_events", "admin", {"value": ["SUBMIT"], "reason": "test: submission only"})
    try:
        clerk = api.post("/worklogs", "clerk1", {"period_id": period["id"]})
        clerk = api.put(f"/worklogs/{clerk['id']}/entries/{period['start_date']}", "clerk1", {**ENTRY["DATA_CLERK"](None), **far})
        assert clerk["entries"][0]["location_status"] == "NOT_CAPTURED" and clerk["entries"][0].get("gps_lat") is None
    finally:
        api.put("/admin/settings/gps_capture_events", "admin", {"value": ["ENTRY", "SUBMIT"], "reason": "test: restore"})


# 7. OTP
def test_otp_attempts_resend_expiry_and_no_plaintext(api, period, db):
    log = submit_and_verify(api, "clerk1", period)
    code = log["otp"]["dev_otp"]
    assert len(code) == 4
    api.post(f"/worklogs/{log['id']}/otp/resend", "clerk1", expect=429)  # cooldown
    api.post(f"/worklogs/{log['id']}/otp/confirm", "supervisor1", {"code": code}, expect=403)
    wrong = "0000" if code != "0000" else "1111"
    for _ in range(5):
        api.post(f"/worklogs/{log['id']}/otp/confirm", "clerk1", {"code": wrong}, expect=400)
    r = api.post(f"/worklogs/{log['id']}/otp/confirm", "clerk1", {"code": code}, expect=400)
    assert "Too many attempts" in r["detail"]

    db.execute(text("update otp_challenges set created_at = created_at - interval '2 minutes' where work_log_id = :id"), {"id": log["id"]})
    db.commit()
    new_code = api.post(f"/worklogs/{log['id']}/otp/resend", "clerk1")["dev_otp"]
    db.execute(text("update otp_challenges set expires_at = now() - interval '1 second' where work_log_id = :id and not is_used"), {"id": log["id"]})
    db.commit()
    assert "No active code" in api.post(f"/worklogs/{log['id']}/otp/confirm", "clerk1", {"code": new_code}, expect=400)["detail"]

    db.execute(text("update otp_challenges set created_at = created_at - interval '2 minutes' where work_log_id = :id"), {"id": log["id"]})
    db.commit()
    final = api.post(f"/worklogs/{log['id']}/otp/resend", "clerk1")["dev_otp"]
    assert api.post(f"/worklogs/{log['id']}/otp/confirm", "clerk1", {"code": final})["status"] == "PENDING_TECHNICAL_REVIEW"

    bodies = [b for (b,) in db.execute(text("select message_body from sms_outbox where event_name = 'WORKLOG_OTP'"))]
    assert bodies and all(c not in body for body in bodies for c in (code, new_code, final))
    audit_text = " ".join(str(r) for r in db.execute(text("select comment, details from work_log_audit where work_log_id = :id"), {"id": log["id"]}))
    assert final not in audit_text


# 20. One identity per person; rotations keep history
def test_rotation_preserves_history_and_identity(api, db):
    from backend.models import Region

    region = db.query(Region).filter(Region.name == "Iringa").one()
    body = {"cadre_id": 3, "first_name": "Test", "last_name": "Rotator", "verified_phone": "+255799000001", "occupation": "Nurse",
            "employment_start_date": "2022-01-01", "assignment": {"region_id": region.id, "facility_id": 1, "section": "OPD"}}
    staff = api.post("/staff", "central1", body)
    api.post("/staff", "central1", body, expect=409)  # no second identity
    api.post(f"/staff/{staff['id']}/rotate", "regadmin1", {"effective_date": "2022-06-01", "reason": "Rotated to CTC",
                                                          "assignment": {"region_id": region.id, "facility_id": 1, "section": "CTC"}})
    detail = api.get(f"/staff/{staff['id']}", "central1")
    assert [(a["section"], str(a["end_date"])) for a in detail["assignments"]] == [("CTC", "None"), ("OPD", "2022-05-31")]
    njombe = db.query(Region).filter(Region.name == "Njombe").one()
    api.post(f"/staff/{staff['id']}/rotate", "regadmin1", {"effective_date": "2022-07-01", "reason": "Move to Njombe",
                                                          "assignment": {"region_id": njombe.id}}, expect=403)  # outside region

    csv_text = "first_name,last_name,phone,cadre,region,district,ward,facility,section,start_date\n" \
               "Test,Rotator,+255799000001,HCP,Iringa,Iringa Urban,Gangilonga,demo iringa dispensary,RCH,2022-09-01\n" \
               "New,Person,+255799000002,CHW,Iringa,,,,,2022-09-01\n" \
               "Bad,Row,+255799000003,ALIEN,Iringa,,,,,2022-09-01\n"
    result = api.call("POST", "/staff/import", "central1", files={"file": ("roster.csv", csv_text, "text/csv")}, data={"enrollment_source": "ENGAGEMENT_LIST"})
    assert (result["created_count"], result["updated_count"], result["error_count"]) == (1, 1, 1)
    assert db.execute(text("select count(*) from staff where verified_phone = '+255799000001'")).scalar() == 1


# 21. Audit is append-only and complete
def test_audit_tables_are_append_only(api, period, db):
    log = submit_and_verify(api, "chw1", period)
    row = api.get(f"/worklogs/{log['id']}", "chw1")["audit"][-1]
    assert row["actor_name"] and row["actor_role"] == "SUPERVISOR" and row["version"] == 1 and row["timestamp"]
    for table in ("work_log_audit", "claim_audit", "budget_transactions", "audit_events"):
        with pytest.raises(Exception, match="append-only"):
            db.execute(text(f"update {table} set id = id"))
        db.rollback()
        with pytest.raises(Exception, match="append-only"):
            db.execute(text(f"delete from {table}"))
        db.rollback()
