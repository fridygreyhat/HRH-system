import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .api.endpoints import admin, auth, batches, budgets, claims, dashboard, staff, worklogs
from .core import config
from .db.session import get_db

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="HRH Digital Work-Log, Payment Claims and Payroll Routing", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(worklogs.router, prefix="/worklogs", tags=["Work logs"])
app.include_router(claims.router, prefix="/claims", tags=["Payment claims"])
app.include_router(batches.router, prefix="/batches", tags=["Payroll batches"])
app.include_router(budgets.router, prefix="/budgets", tags=["Budgets"])
app.include_router(staff.router, prefix="/staff", tags=["Staff registry"])
app.include_router(admin.router, prefix="/admin", tags=["Administration"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])


@app.get("/")
def read_root():
    return {"message": "HRH backend is running", "version": app.version, "docs": "/docs"}


DEMO_ACCOUNTS = [
    ("chw1", "Community Health Worker", "Provider"),
    ("clerk1", "Data Clerk", "Provider"),
    ("hcp1", "Health Care Provider", "Provider"),
    ("supervisor1", "CTC In-Charge", "Review"),
    ("facilityic1", "Facility In-Charge", "Review"),
    ("tofficer1", "Technical Officer", "Review"),
    ("rpm1", "Regional Program Manager", "Review"),
    ("fhifin1", "FHI360 Finance (preparer)", "Finance"),
    ("fhifin2", "FHI360 Finance (approver)", "Finance"),
    ("csofin1", "CSO Finance (preparer)", "Finance"),
    ("csofin2", "CSO Finance (approver)", "Finance"),
    ("verifier1", "Community Verifier", "Review"),
    ("oversight1", "FHI360 Oversight", "Oversight"),
    ("central1", "Central Administrator", "Admin"),
]


@app.get("/meta")
def meta():
    """Public: what the sign-in page may show. Demo accounts are listed only when demo data is seeded."""
    return {
        "version": app.version,
        "timezone": config.TIMEZONE,
        "demo": config.SEED_DEMO_DATA,
        "demo_accounts": [{"username": u, "label": l, "group": g} for u, l, g in DEMO_ACCOUNTS] if config.SEED_DEMO_DATA else [],
    }


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": str(e)}
