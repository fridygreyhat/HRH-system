"""Full monthly salary per salary scale, entered by Central Finance. Amounts are shown in CSO files only."""
from sqlalchemy import func

from ..models import SalaryScaleAmount, Staff


def amounts_for(db, month):
    """The amount in force for each scale in a month: its latest start month on or before that month."""
    rows = db.query(SalaryScaleAmount).filter(SalaryScaleAmount.start_month <= month).order_by(SalaryScaleAmount.start_month)
    return {row.scale: row.monthly_amount for row in rows}


def overview(db, month):
    """Every scale in use or priced, so a scale with no amount is visible rather than quietly missing."""
    providers = dict(db.query(func.trim(Staff.salary_scale), func.count(Staff.id)).filter(
        Staff.status == "ACTIVE", func.trim(Staff.salary_scale) != "").group_by(func.trim(Staff.salary_scale)).all())
    history = {}
    for row in db.query(SalaryScaleAmount).order_by(SalaryScaleAmount.start_month.desc()):
        history.setdefault(row.scale, []).append({"start_month": row.start_month, "monthly_amount": str(row.monthly_amount)})
    current = amounts_for(db, month)
    return [{"scale": scale, "providers": providers.get(scale, 0),
             "monthly_amount": str(current[scale]) if scale in current else None, "history": history.get(scale, [])}
            for scale in sorted(set(providers) | set(history))]
