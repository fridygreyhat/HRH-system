"""Explicit Super Admin-only configuration export, review and atomic missing-only apply."""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.responses import Response
from pydantic import Field
from sqlalchemy.orm import Session

from ...core.security import CurrentUser, require_roles
from ...core.roles import SUPER_ADMIN
from ...db.session import get_db
from ...services import setup_transfer as service
from ...services.setup_transfer_schema import Strict, TransferDocument

class BoundedSetupRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def bounded(request: Request):
            if request.method == "POST":
                body = bytearray()
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > 2 * 1024 * 1024:
                        raise HTTPException(413, "Setup request exceeds 2 MiB")
                request._body = bytes(body)
            return await handler(request)

        return bounded


router = APIRouter(route_class=BoundedSetupRoute)


class Review(Strict):
    document: TransferDocument


class Apply(Review):
    selected_ids: list[str] = Field(min_length=1, max_length=250)
    review_token: str = Field(min_length=1, max_length=2000)
    reason: str = Field(min_length=3, max_length=1000)
    confirmation: str = Field(pattern=r"^APPLY MISSING SETUP$")


@router.get("/export")
def export(db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    return Response(service.export_document(db).model_dump_json(), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="hrh-setup-transfer.json"'})


@router.post("/review")
def review(body: Review, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    return service.review(db, current, body.document)


@router.post("/apply")
def apply(body: Apply, db: Session = Depends(get_db), current: CurrentUser = Depends(require_roles(SUPER_ADMIN))):
    return service.apply(db, current, body.document, body.selected_ids, body.review_token, body.reason)
