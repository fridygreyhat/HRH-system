from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...core import audit as system_audit
from ...core.roles import CSO_FINANCE, FHI360_FINANCE, OVERSIGHT
from ...core.security import CurrentUser, require_roles
from ...core.serialize import to_dict
from ...db.session import get_db
from ...models import Organization, PaymentClaim, PayrollBatch, User
from ...services import batches as bt

router = APIRouter()


class BatchCreate(BaseModel):
    route_code: str


def _get(db: Session, current: CurrentUser, batch_id: int, lock: bool = False) -> PayrollBatch:
    query = db.query(PayrollBatch).filter(PayrollBatch.id == batch_id, bt.batch_visibility(current))
    batch = (query.with_for_update() if lock else query).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


def _out(db: Session, batch: PayrollBatch, current: CurrentUser, lines: bool = False) -> dict:
    name = lambda model, i: (getattr(db.get(model, i), "name", None) or getattr(db.get(model, i), "full_name", None)) if i else None  # noqa: E731
    claims = db.query(PaymentClaim).filter(PaymentClaim.batch_id == batch.id).all()
    out = {
        **to_dict(batch, exclude=("export_snapshot", "export_csv")),
        "payor_name": name(Organization, batch.payor_org_id),
        "executor_name": name(Organization, batch.executor_org_id),
        "created_by_name": name(User, batch.created_by),
        "payment_progress": {s: sum(1 for c in claims if c.payment_status == s) for s in {c.payment_status for c in claims}},
        "can_hand_off": batch.route_code == "B" and batch.status == bt.EXPORTED and FHI360_FINANCE in current.roles,
        "can_receive": batch.route_code == "B" and batch.status == bt.HANDED_OFF and CSO_FINANCE in current.roles
        and batch.executor_org_id in current.scope_values("organization_id"),
    }
    if lines:
        out["lines"] = [
            {k: v for k, v in line.items() if k not in ("payment_account", "phone") or current.has_any(FHI360_FINANCE, CSO_FINANCE)}
            for line in batch.export_snapshot.get("lines", [])
        ]
        out["claims"] = [{"id": c.id, "status": c.status, "payment_status": c.payment_status} for c in claims]
    return out


@router.get("")
def list_batches(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE, OVERSIGHT))):
    rows = db.query(PayrollBatch).filter(bt.batch_visibility(current)).order_by(PayrollBatch.id.desc()).limit(200).all()
    return [_out(db, b, current) for b in rows]


@router.post("", status_code=201)
def create_batches(body: BatchCreate, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    created = bt.create_batches(db, current, body.route_code.upper())
    db.commit()
    return [_out(db, b, current) for b in created]


@router.get("/{batch_id}")
def get_batch(batch_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE, OVERSIGHT))):
    return _out(db, _get(db, current, batch_id), current, lines=True)


@router.get("/{batch_id}/export.{fmt}")
def download(batch_id: int, fmt: str, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE, CSO_FINANCE))):
    batch = _get(db, current, batch_id)
    system_audit.record(db, current, "payroll_batch", batch.id, f"download_{fmt}")
    db.commit()
    if fmt == "csv":
        # Rebuilt from the immutable snapshot so batches exported before formula-escaping download safely too.
        content, media = bt.to_csv(batch).encode(), "text/csv"
    elif fmt == "xlsx":
        content, media = bt.to_xlsx(batch), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        raise HTTPException(status_code=404, detail="Format must be csv or xlsx")
    return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{batch.reference}.{fmt}"'})


@router.post("/{batch_id}/hand-off")
def hand_off(batch_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(FHI360_FINANCE))):
    batch = bt.hand_off(db, current, _get(db, current, batch_id, lock=True))
    db.commit()
    return _out(db, batch, current, lines=True)


@router.post("/{batch_id}/receive")
def receive(batch_id: int, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(CSO_FINANCE))):
    batch = bt.receive(db, current, _get(db, current, batch_id, lock=True))
    db.commit()
    return _out(db, batch, current, lines=True)
