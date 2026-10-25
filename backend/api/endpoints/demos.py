"""Authenticated, immutable replay data; no demo actions can mutate the real app."""
from fastapi import APIRouter, Depends, HTTPException, Response

from ...core.security import get_current_user
from ...services.demo_walkthrough import sample_proof_pdf, walkthrough

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/workflows")
def workflows():
    try:
        return walkthrough()
    except FileNotFoundError:
        raise HTTPException(503, "The isolated demo walkthrough has not been generated yet")


@router.get("/sample-proof.pdf")
def sample_proof():
    return Response(
        sample_proof_pdf(), media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="DEMO-NOT-REAL-PAYMENT.pdf"'},
    )
