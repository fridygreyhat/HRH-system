import csv
import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from .api.endpoints import admin, auth, batches, budgets, claims, dashboard, demos, staff, worklogs, rates, finance
from .api.endpoints import monthly_budgets
from .core import config
from .db.session import get_db
from .api.endpoints import backdate_access, organizations, community_claims, provider_payment_details, cso_finance
from .api.endpoints import setup_transfer

logging.basicConfig(level=logging.INFO)

_docs = config.ENABLE_API_DOCS
app = FastAPI(title="HRH Digital Work-Log, Payment Claims and Payroll Routing", version="2.0.0",
              docs_url="/docs" if _docs else None, redoc_url="/redoc" if _docs else None, openapi_url="/openapi.json" if _docs else None)


@app.middleware("http")
async def prevent_api_caching(request, call_next):
    """Never retain financial records, exports or authentication responses in caches."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


# Input the database refuses is the caller's mistake, not a server error. The request's session rolls back on close.
@app.exception_handler(DataError)
def value_out_of_range(_: Request, __: DataError):
    return JSONResponse({"detail": "A value is too long or out of range"}, status_code=422)


@app.exception_handler(IntegrityError)
def conflicting_data(_: Request, __: IntegrityError):
    return JSONResponse({"detail": "This conflicts with existing data or refers to something that does not exist"}, status_code=409)


@app.exception_handler(ValueError)
def nul_character(_: Request, exc: ValueError):
    if "NUL (0x00)" in str(exc):  # raised by the database driver for any text containing a NUL
        return JSONResponse({"detail": "Text cannot contain NUL characters"}, status_code=422)
    raise exc


@app.exception_handler(csv.Error)
def malformed_csv(_: Request, exc: csv.Error):
    return JSONResponse({"detail": f"The file is not a valid CSV: {exc}"}, status_code=422)


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
app.include_router(monthly_budgets.router, prefix="/monthly-service-budgets", tags=["Monthly regional Services budgets"])
app.add_api_route("/budget/allocate", budgets.create_line, methods=["POST"], status_code=201, tags=["Central Budget Management"])
app.include_router(organizations.router, prefix="/organizations", tags=["Organizations and CSO regions"])
app.include_router(provider_payment_details.router, prefix="/provider-details", tags=["Provider payment details"])
app.include_router(cso_finance.router, prefix="/cso-finance", tags=["CSO Finance"])
app.include_router(staff.router, prefix="/staff", tags=["Staff registry"])
app.include_router(admin.router, prefix="/admin", tags=["Administration"])
app.include_router(setup_transfer.router, prefix="/admin/setup-transfer", tags=["Super Admin setup transfer"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])


@app.get("/")
def read_root():
    return {"message": "HRH backend is running", "version": app.version}


@app.get("/meta")
def meta():
    """Public: version and operational timezone for the sign-in page."""
    return {"version": app.version, "timezone": config.TIMEZONE}


@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception:
        logging.getLogger(__name__).error("Database health check failed")
        return JSONResponse(status_code=503, content={"status": "unhealthy", "database": "unavailable"})
