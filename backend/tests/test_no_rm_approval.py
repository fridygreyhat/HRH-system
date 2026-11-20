"""RM approval switched off: the technical review approves the timesheet and it goes straight on.

Services go to Regional Finance with the claim priced at the technical approval; Payroll is approved, ready for
Regional Finance and the monthly report. The RM never receives it. Switching the setting back on restores the RM step.
"""
import pytest

from .test_v22_finance import entered_log, priced_activity, v22  # noqa: F401  (v22 is a fixture)


@pytest.fixture
def no_rm(api):
    previous = api.get("/auth/me", "chw1")["client_settings"]["rm_approval_required"]
    api.put("/admin/settings/rm_approval_required", "admin", {"value": False, "reason": "Test workflow without the RM step"})
    try:
        yield
    finally:
        api.put("/admin/settings/rm_approval_required", "admin", {"value": previous, "reason": "Restore test policy"})


def through_technical(api, log):
    body = {"review_confirmed": True, "review_type": log["work_type"]}
    if log["status"] == "DRAFT":
        log = api.post(f"/worklogs/{log['id']}/actions/submit", "chw1", {"attest": True})
    log = api.post(f"/worklogs/{log['id']}/actions/verify", "supervisor1", body)
    if log["status"] == "PENDING_PROVIDER_OTP_CONFIRMATION":
        log = api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})
    assert log["status"] == "PENDING_TECHNICAL_REVIEW"
    return api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", body)


def queue_ids(api, user):
    return {row["id"] for row in api.get("/worklogs?queue=true", user)}


def test_the_app_default_is_without_rm_and_screens_are_told():
    from backend.core.settings import DEFAULTS
    assert DEFAULTS["rm_approval_required"] is False


def test_services_go_from_technical_review_to_regional_finance(api, db, period, v22, no_rm):
    from backend.models import ClaimAudit, WorkLogAudit
    assert api.get("/auth/me", "tofficer1")["client_settings"]["rm_approval_required"] is False
    log = through_technical(api, entered_log(api, period, priced_activity(api, v22, period)))
    assert log["status"] == "PENDING_FINANCE_REVIEW"
    assert log["approved_at"] and not log["finance_timesheet_approved_at"]
    assert log["id"] not in queue_ids(api, "rpm1")
    assert log["id"] in queue_ids(api, v22["finance"])
    assert "finance_timesheet_approve" in api.get(f"/worklogs/{log['id']}", v22["finance"])["available_actions"]
    # The claim RM used to prepare is priced at the technical approval, still unrouted and uncommitted.
    claim = log["claims"][0]
    assert claim["status"] == "PENDING_FINANCE_REVIEW" and float(claim["amount"]) == 300
    prepared = db.query(ClaimAudit).filter_by(claim_id=claim["id"]).one()
    assert (prepared.action, prepared.actor_role) == ("prepare", "TECHNICAL_OFFICER")
    endorsed = db.query(WorkLogAudit).filter_by(work_log_id=log["id"], action="endorse").one()
    assert endorsed.new_status == "PENDING_FINANCE_REVIEW" and endorsed.details["rm_approval"] == "not required"


def test_payroll_is_approved_at_technical_review(api, db, period, v22, no_rm):
    from .test_ctc_facility_approval import submitted_log
    log = through_technical(api, submitted_log(api, db, period, "chw1", "PAYROLL"))
    assert log["status"] == "APPROVED" and log["approved_at"] and log["claims"] == []
    assert log["id"] not in queue_ids(api, "rpm1")
    assert "finance_timesheet_approve" in api.get(f"/worklogs/{log['id']}", v22["finance"])["available_actions"]
    approved = api.post(f"/worklogs/{log['id']}/actions/finance_timesheet_approve", v22["finance"],
                        {"review_confirmed": True, "review_type": "PAYROLL"})
    assert approved["status"] == "APPROVED" and approved["finance_timesheet_approved_at"]


def test_switching_rm_approval_back_on_restores_the_rm_step(api, period, v22, no_rm):
    api.put("/admin/settings/rm_approval_required", "admin", {"value": True, "reason": "RM step restored"})
    log = through_technical(api, entered_log(api, period, priced_activity(api, v22, period)))
    assert log["status"] == "PENDING_RPM_AUTHORIZATION" and not log["claims"]
    assert log["id"] in queue_ids(api, "rpm1")
