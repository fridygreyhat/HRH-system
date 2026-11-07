"""Regional Finance approves the timesheet, then separately approves the Services payment."""
from .conftest import category_id
from .test_v22_finance import back_through_technical, entered_log, priced_activity, to_finance, v22

ACTION = "finance_timesheet_approve"


def confirmed(kind="SERVICES", **extra):
    return {"review_confirmed": True, "review_type": kind, **extra}


def pending(api, period, v22):
    return to_finance(api, entered_log(api, period, priced_activity(api, v22, period)))


def act(api, log, action, user, body=None, expect=None):
    """`api.post` approves the timesheet before `finance_review`, so these tests call directly."""
    return api.call("POST", f"/worklogs/{log['id']}/actions/{action}", user, json=confirmed() if body is None else body, expect=expect)


def queue_row(api, v22, log):
    return next(row for row in api.get("/finance/pending-routing", v22["finance"]) if row["work_log_id"] == log["id"])


def test_payment_review_is_refused_until_the_timesheet_is_approved(api, db, period, v22):
    log = pending(api, period, v22)
    actions = api.get(f"/worklogs/{log['id']}", v22["finance"])["available_actions"]
    assert ACTION in actions and "finance_review" not in actions
    assert queue_row(api, v22, log)["next_action"] == "REVIEW_TIMESHEET"
    refused = act(api, log, "finance_review", v22["finance"], confirmed(category_id=category_id(db, "A")), expect=403)
    assert "until the timesheet is approved" in refused["detail"]

    approved = act(api, log, ACTION, v22["finance"])
    assert approved["status"] == "PENDING_FINANCE_REVIEW" and approved["finance_timesheet_approved_at"]
    assert ACTION not in approved["available_actions"] and "finance_review" in approved["available_actions"]
    assert queue_row(api, v22, log)["next_action"] == "REVIEW_AMOUNT"

    reviewed = act(api, log, "finance_review", v22["finance"], confirmed(category_id=category_id(db, "A")))
    assert reviewed["status"] == "FINANCE_REVIEWED"
    assert queue_row(api, v22, log)["next_action"] == "CHANNEL"


def test_approval_records_who_and_when_but_keeps_the_name_out_of_reviewer_payloads(api, db, period, v22):
    from backend.models import User, WorkLog, WorkLogAudit
    log = pending(api, period, v22)
    approved = act(api, log, ACTION, v22["finance"])
    db.expire_all()
    saved = db.get(WorkLog, log["id"])
    assert db.get(User, saved.finance_timesheet_approved_by).username == v22["finance"]
    assert saved.finance_timesheet_approved_at
    row = db.query(WorkLogAudit).filter_by(work_log_id=log["id"], action=ACTION).one()
    assert row.actor_id == saved.finance_timesheet_approved_by and row.actor_role == "REGIONAL_FINANCE"
    assert "finance_timesheet_approved_by" not in approved and approved["audit"] == []


def test_only_scoped_regional_finance_can_approve_and_only_once(api, period, v22):
    log = pending(api, period, v22)
    for user in ("fhifin1", "rpm1", "tofficer1", "chw1"):
        act(api, log, ACTION, user, expect=403)
    act(api, log, ACTION, v22["finance"], {}, expect=422)
    act(api, log, ACTION, v22["finance"])
    assert "already approved" in act(api, log, ACTION, v22["finance"], expect=403)["detail"]


def test_approval_moves_no_money_and_leaves_the_stage_unchanged(api, db, period, v22):
    from backend.models import MonthlyServiceBudgetCharge, PaymentClaim, SMSOutbox, WorkLog
    log = pending(api, period, v22)
    db.expire_all()
    before = db.get(WorkLog, log["id"]).status_changed_at
    messages = db.query(SMSOutbox).count()
    act(api, log, ACTION, v22["finance"])
    db.expire_all()
    saved = db.get(WorkLog, log["id"])
    assert saved.status_changed_at == before and saved.finance_snapshot is None
    assert db.query(SMSOutbox).count() == messages
    claim = db.query(PaymentClaim).filter_by(work_log_id=log["id"]).one()
    assert claim.status == "PENDING_FINANCE_REVIEW"
    assert db.query(MonthlyServiceBudgetCharge).filter_by(claim_id=claim.id).count() == 0


def test_a_returned_record_needs_a_fresh_timesheet_approval(api, db, period, v22):
    log = pending(api, period, v22)
    act(api, log, ACTION, v22["finance"])
    act(api, log, "finance_review", v22["finance"], confirmed(category_id=category_id(db, "A")))
    returned = act(api, log, "return", v22["finance"], confirmed(comment="Check the hours"))
    assert returned["finance_timesheet_approved_at"] is None
    again = back_through_technical(api, returned)
    assert again["status"] == "PENDING_FINANCE_REVIEW" and again["finance_timesheet_approved_at"] is None
    assert queue_row(api, v22, log)["next_action"] == "REVIEW_TIMESHEET"
    act(api, log, "finance_review", v22["finance"], confirmed(category_id=category_id(db, "A")), expect=403)


def test_a_rejected_record_loses_its_timesheet_approval(api, period, v22):
    log = pending(api, period, v22)
    act(api, log, ACTION, v22["finance"])
    rejected = act(api, log, "reject", v22["finance"], confirmed(comment="Wrong month"))
    assert rejected["status"] == "REJECTED" and rejected["finance_timesheet_approved_at"] is None


def test_payroll_still_ends_at_rm_with_no_finance_approval(api, db, period, v22):
    from .test_finance_routing import approved_payroll
    log = approved_payroll(api, db, period)
    assert log["status"] == "APPROVED" and ACTION not in api.get(f"/worklogs/{log['id']}", v22["finance"])["available_actions"]
    act(api, log, ACTION, v22["finance"], confirmed("PAYROLL"), expect=403)
