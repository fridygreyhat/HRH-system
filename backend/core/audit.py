from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import AuditEvent


def record(
    db: Session,
    actor,
    entity_type: str,
    entity_id: Any,
    action: str,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    reason: Optional[str] = None,
) -> None:
    """Append a system audit event. `actor` is a CurrentUser or None (system)."""
    db.add(
        AuditEvent(
            actor_id=actor.id if actor else None,
            actor_roles=",".join(sorted(actor.roles)) if actor else "SYSTEM",
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            action=action,
            before=_jsonable(before),
            after=_jsonable(after),
            reason=reason,
        )
    )


def _jsonable(value):
    if value is None:
        return None
    from fastapi.encoders import jsonable_encoder

    return jsonable_encoder(value)
