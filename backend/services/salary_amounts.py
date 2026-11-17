"""Full monthly salary per salary scale, entered by Central Finance. Amounts are shown in CSO files only."""
from decimal import Decimal

from sqlalchemy import func

from ..models import SalaryScaleAmount, Staff


# Every Community Health Worker is paid the CHW package, whatever salary scale is on their record.
CHW_SCALE = "CHW"
CHW_PARTS = (("stipend", "Monthly stipend"), ("transport", "Transport"), ("communication", "Communication"))
CHW_DEFAULT = {"stipend": Decimal("100000.00"), "transport": Decimal("30000.00"), "communication": Decimal("20000.00")}


def chw_components(amounts: dict) -> list[dict]:
    return [{"key": key, "name": name, "amount": str(Decimal(amounts[key]).quantize(Decimal("0.01")))} for key, name in CHW_PARTS]


def payroll_scale(cadre_code, scale) -> str:
    """The salary amount a provider is paid by: the CHW package for a CHW, otherwise their salary scale."""
    return CHW_SCALE if cadre_code == "CHW" else (scale or "").strip()


def _in_force(db, month):
    rows = db.query(SalaryScaleAmount).filter(SalaryScaleAmount.start_month <= month).order_by(SalaryScaleAmount.start_month)
    return {row.scale: row for row in rows}


def amounts_for(db, month):
    """The amount in force for each scale in a month: its latest start month on or before that month."""
    amounts = {scale: row.monthly_amount for scale, row in _in_force(db, month).items()}
    amounts.setdefault(CHW_SCALE, sum(CHW_DEFAULT.values()))
    return amounts


def components_for(db, month):
    """The parts of each amount in force that has them (the CHW package always has them)."""
    parts = {scale: row.components for scale, row in _in_force(db, month).items() if row.components}
    parts.setdefault(CHW_SCALE, chw_components(CHW_DEFAULT))
    return parts


def overview(db, month):
    """Every scale in use or priced, so a scale with no amount is visible rather than quietly missing.

    CHWs are counted under the CHW package, not their salary scale, since that is what they are paid."""
    from ..models import Cadre
    chw = db.query(Cadre.id).filter(Cadre.code == "CHW").scalar()
    active = db.query(Staff).filter(Staff.status == "ACTIVE")
    providers = dict(active.filter(Staff.cadre_id != chw, func.trim(Staff.salary_scale) != "").with_entities(
        func.trim(Staff.salary_scale), func.count(Staff.id)).group_by(func.trim(Staff.salary_scale)).all())
    providers[CHW_SCALE] = active.filter(Staff.cadre_id == chw).count()
    parts = components_for(db, month)
    history = {}
    for row in db.query(SalaryScaleAmount).order_by(SalaryScaleAmount.start_month.desc()):
        history.setdefault(row.scale, []).append({"start_month": row.start_month, "monthly_amount": str(row.monthly_amount)})
    current = amounts_for(db, month)
    return [{"scale": scale, "providers": providers.get(scale, 0),
             "monthly_amount": str(current[scale]) if scale in current else None, "history": history.get(scale, []),
             "components": parts.get(scale), "is_chw_package": scale == CHW_SCALE}
            for scale in sorted(set(providers) | set(history), key=lambda name: (name != CHW_SCALE, name))]
