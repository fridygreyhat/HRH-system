"""Synthetic setup for independent test databases only; never imported by runtime."""
from backend.models import MonthlyServiceBudget, StaffAssignment, User, WorkLog


def ensure_monthly_budgets(db, log_id, username, amount=10000000):
    db.expire_all()  # the API changed the snapshot through its own session
    log = db.get(WorkLog, log_id)
    placement = db.get(StaffAssignment, log.assignment_id)
    actor = db.query(User).filter_by(username=username).one()
    months = {line["date"][:7] for line in log.finance_snapshot["lines"]}
    for month in months:
        if not db.query(MonthlyServiceBudget).filter_by(region_id=placement.region_id, month=month, currency="TZS").first():
            db.add(MonthlyServiceBudget(region_id=placement.region_id, month=month, currency="TZS",
                allocated_amount=amount, deducted_amount=0, document_name="isolated-budget.csv",
                document_type="text/csv", document_data=b"amount\n10000000\n", uploaded_by=actor.id))
    db.commit()
