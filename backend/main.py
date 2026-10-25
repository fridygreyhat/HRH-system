import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .api.endpoints import admin, auth, batches, budgets, claims, dashboard, demos, staff, worklogs, rates, finance
from .core import config
from .db.session import get_db
from .api.endpoints import backdate_access, organizations, community_claims

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
app.include_router(backdate_access.router, prefix="/backdate-access", tags=["Backdated entry access"])
app.include_router(demos.router, prefix="/demos", tags=["Read-only simulated demos"])
app.include_router(worklogs.router, prefix="/worklogs", tags=["Work logs"])
app.include_router(rates.router, prefix="/rates", tags=["Activity rates"])
app.include_router(finance.router, prefix="/finance", tags=["Regional Finance"])
app.include_router(claims.router, prefix="/claims", tags=["Payment claims"])
app.include_router(community_claims.router, prefix="/community-claims", tags=["Direct community claims"])
app.include_router(batches.router, prefix="/batches", tags=["Payroll batches"])
app.include_router(budgets.router, prefix="/budgets", tags=["Budgets"])
app.include_router(organizations.router, prefix="/organizations", tags=["Organizations and CSO regions"])
app.include_router(staff.router, prefix="/staff", tags=["Staff registry"])
app.include_router(admin.router, prefix="/admin", tags=["Administration"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])


@app.get("/")
def read_root():
    return {"message": "HRH backend is running", "version": app.version, "docs": "/docs"}


@app.get("/meta")
def meta():
    """Public: version and operational timezone for the sign-in page."""
    return {"version": app.version, "timezone": config.TIMEZONE}


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": str(e)}
