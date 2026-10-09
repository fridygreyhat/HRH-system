"""With provider_otp_required off, CTC verification goes straight to technical review."""
from .conftest import draft_log


def _set(api, value: bool):
    api.put("/admin/settings/provider_otp_required", "admin", {"value": value, "reason": "SMS gateway not ready"})


def test_verify_skips_provider_confirmation_when_off(api, period):
    _set(api, False)
    try:
        assert api.get("/auth/me", "chw1")["client_settings"]["provider_otp_required"] is False
        log = draft_log(api, "chw1", period)
        api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
        verified = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {"expected_version": log["version"]})
        assert verified["status"] == "PENDING_TECHNICAL_REVIEW"
        assert verified["confirmed_version"] == verified["version"]
        assert any(w["id"] == log["id"] for w in api.get("/worklogs?queue=true", "tofficer1"))
    finally:
        _set(api, True)


def test_waiting_log_confirms_without_code_when_switched_off(api, period):
    log = draft_log(api, "chw1", period)
    api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    verified = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", {"expected_version": log["version"]})
    assert verified["status"] == "PENDING_PROVIDER_OTP_CONFIRMATION"
    api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {}, expect=422)  # a code is still needed while it is on
    _set(api, False)
    try:
        confirmed = api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {})
        assert confirmed["status"] == "PENDING_TECHNICAL_REVIEW"
    finally:
        _set(api, True)


def test_submit_requires_location_when_switched_on(api, period):
    api.put("/admin/settings/gps_required_on_submit", "admin", {"value": True, "reason": "field policy"})
    try:
        log = draft_log(api, "chw1", period)
        api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True}, expect=422)
        api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True, "gps_lat": -7.77, "gps_lon": 35.69, "gps_accuracy_m": 20})
    finally:
        api.put("/admin/settings/gps_required_on_submit", "admin", {"value": False, "reason": "reset"})


def test_estimate_uses_approved_rates(api, period):
    log = draft_log(api, "chw1", period)
    estimate = api.get(f"/worklogs/{log['id']}/estimate", "chw1")
    assert estimate["totals"], estimate  # the test data has approved CHW rates
    assert all(float(line["amount"]) >= 0 for line in estimate["lines"])
