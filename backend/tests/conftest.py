"""Acceptance harness using a throwaway PostgreSQL database.

Set HRH_TEST_DATABASE to an unused test-only name before running. Never target
production: the selected test database is dropped and recreated.
"""
import calendar
import itertools
import os
from datetime import date
from functools import partial
from unittest.mock import patch

import psycopg2
import pytest

BASE_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg2://hrh_user:hrh_password@db:5432/hrh_db")
TEST_DB = os.environ.get("HRH_TEST_DATABASE", "hrh_test")
os.environ["DATABASE_URL"] = BASE_URL.rsplit("/", 1)[0] + "/" + TEST_DB
# Tests read SMS codes from API responses (mock gateway only); sample data comes from tests/demo_data.py.
os.environ.update({"SMS_GATEWAY_TYPE": "mock", "EXPOSE_DEV_OTP": "true", "UPLOAD_DIR": "/tmp/hrh-test-uploads"})

PASSWORD = "Demo@12345"


def _admin_dsn() -> str:
    return BASE_URL.replace("postgresql+psycopg2://", "postgresql://").rsplit("/", 1)[0] + "/postgres"


@pytest.fixture(scope="session")
def client():
    conn = psycopg2.connect(_admin_dsn())
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        cur.execute(f"CREATE DATABASE {TEST_DB}")
    conn.close()

    from alembic import command
    from alembic.config import Config

    command.upgrade(Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini")), "head")
    from backend.seed import main as seed_main

    from backend.core import config as app_config

    with patch.object(app_config, "ADMIN_PASSWORD", "admin12345"):
        seed_main()
    from backend.db.session import SessionLocal
    from backend.tests.demo_data import seed_test_data

    with SessionLocal() as session:
        seed_test_data(session)
        # Tests act as the bootstrap administrator directly, so skip its first-sign-in password change.
        from backend.models import SystemSetting, User

        session.query(User).filter(User.username == "admin").update({User.must_change_password: False})
        # The acceptance suite uses archived periods; keep that separate from
        # the production 48-hour grace policy.
        session.merge(SystemSetting(key="backdate_grace_hours", value=1000000))
        session.commit()
    from fastapi.testclient import TestClient

    from backend.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db(client):
    from backend.db.session import SessionLocal

    session = SessionLocal()
    yield session
    session.close()


class Api:
    def __init__(self, client):
        self.client = client
        self.tokens: dict[str, str] = {}

    def token(self, user: str) -> str:
        if user not in self.tokens:
            password = "admin12345" if user == "admin" else PASSWORD
            r = self.client.post("/auth/login", data={"username": user, "password": password})
            assert r.status_code == 200, r.text
            self.tokens[user] = r.json()["access_token"]
        return self.tokens[user]

    def call(self, method: str, path: str, user: str, json=None, expect: int | None = None, **kwargs):
        r = self.client.request(method, path, headers={"Authorization": f"Bearer {self.token(user)}"}, json=json, **kwargs)
        if expect is None:
            assert r.status_code < 300, f"{method} {path} as {user} -> {r.status_code} {r.text}"
        else:
            assert r.status_code == expect, f"{method} {path} as {user} -> {r.status_code} (expected {expect}) {r.text}"
        if r.content and r.headers.get("content-type", "").startswith("application/json"):
            return r.json()
        return r

    def get(self, path, user, **kw):
        return self.call("GET", path, user, **kw)

    def post(self, path, user, json=None, **kw):
        return self.call("POST", path, user, json=json if json is not None else {}, **kw)

    def put(self, path, user, json=None, **kw):
        return self.call("PUT", path, user, json=json, **kw)


@pytest.fixture()
def api(client):
    return Api(client)


_months = itertools.count()


@pytest.fixture()
def period(api, db):
    """A fresh past pay period with DEMO budget lines, so every test has its own work logs and budgets."""
    return make_period(api, db)


def make_period(api: Api, db, amounts: dict | None = None) -> dict:
    n = next(_months)
    year, month = 2023 - n // 12, 12 - n % 12
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    p = api.post("/admin/pay-periods", "central1", {"start_date": str(start), "end_date": str(end), "period_label": f"TEST {start:%b %Y}", "status": "OPEN"})
    amounts = amounts or {}
    from backend.models import ClaimCategory, Organization

    org = {o.name: o.id for o in db.query(Organization)}
    cat = {c.name: c.id for c in db.query(ClaimCategory)}
    for code, org_name, cat_name, user, default in (
        ("DEMO-A-01", "FHI360", "DEMO – PnP activity (Route A)", "fhifin1", 5_000_000),
        ("DEMO-B-01", "DEMO CSO Iringa", "DEMO – Facility payroll (Route B)", "csofin1", 3_000_000),
        ("DEMO-C-01", "DEMO CSO Iringa", "DEMO – Community service (Route C)", "csofin1", 1_000_000),
        ("DEMO-B-01", "DEMO CSO Njombe", "DEMO – Facility payroll (Route B)", "csofin3", 2_000_000),
    ):
        api.post("/budgets/lines", user, {"code": code, "name": code, "organization_id": org[org_name], "category_id": cat[cat_name],
                                         "period_id": p["id"], "allocated_amount": amounts.get((code, org_name), default)})
    return p


def category_id(db, route: str) -> int:
    from backend.models import ClaimCategory

    return db.query(ClaimCategory).filter(ClaimCategory.name.like(f"%(Route {route})")).one().id


ENTRY = {
    "CHW": lambda d: {"activity_key": "appointment_followup", "hours_worked": 8.5, "evidence_text": "Home visits and tracing in the community", "measures": {"clients_followed_up": 5, "ltfu_clients_assigned": 9, "clients_returned_to_care": 1}},
    "DATA_CLERK": lambda d: {"activity_key": "ctc_data", "start_time": "07:30", "end_time": "15:30", "evidence_text": "Updated CTC database and uploaded dataset", "measures": {"ctc_clients_registered": 8, "ctc_visits_updated": 8, "hts_clients_registered": 12, "pharmacy_visits_entered": 8, "ctc_hts_dataset_uploaded": True}},
    "HCP": lambda d: {"activity_key": "index_testing", "start_time": "16:00", "end_time": "18:00", "evidence_text": "Index testing session at OPD", "measures": {"clients_tested_hiv": 6, "clients_tested_index": 6, "hcp_index_appointments": 6, "hcp_index_positive": 1, "clients_tested_positive_new": 1, "hiv_positive_linked_art": 1}},
}


def _complete_activity_entry(code, factory, day):
    """Keep legacy fixture counts while explicitly completing new indicators."""
    from backend.seed import CADRES
    from backend.services.activities import FIELD_SPECS, activity_for

    body = factory(day)
    specs = next(c["fields"] for c in CADRES if c["code"] == code) + FIELD_SPECS[code]
    types = {spec[0]: spec[3] if len(spec) > 3 else "INTEGER" for spec in specs}
    activity = activity_for(code, body["activity_key"])
    values = {key: False if types[key] == "BOOLEAN" else 0 for key in activity["required_fields"]}
    body["measures"] = {**values, **body["measures"]}
    return body


ENTRY = {code: partial(_complete_activity_entry, code, factory) for code, factory in ENTRY.items()}
PROVIDER_CADRE = {"chw1": "CHW", "clerk1": "DATA_CLERK", "hcp1": "HCP", "hcp2": "HCP"}


def draft_log(api: Api, provider: str, period: dict, days: int = 2) -> dict:
    log = api.post("/worklogs", provider, {"period_id": period["id"]})
    start = date.fromisoformat(period["start_date"])
    for i in range(days):
        d = start.replace(day=start.day + i)
        log = api.put(f"/worklogs/{log['id']}/entries/{d}", provider, ENTRY[PROVIDER_CADRE[provider]](d))
    return log


def submit_and_verify(api: Api, provider: str, period: dict, supervisor: str = "supervisor1") -> dict:
    log = draft_log(api, provider, period)
    api.post(f"/worklogs/{log['id']}/actions/submit", provider, {"attest": True})
    return api.post(f"/worklogs/{log['id']}/actions/verify", supervisor, {"expected_version": log["version"]})


def approved_log(api: Api, provider: str, period: dict) -> dict:
    log = submit_and_verify(api, provider, period)
    api.post(f"/worklogs/{log['id']}/otp/confirm", provider, {"code": log["otp"]["dev_otp"]})
    if PROVIDER_CADRE[provider] == "HCP":
        api.post(f"/worklogs/{log['id']}/actions/facility_endorse", "facilityic1", {"comment": "Facility records checked"})
    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", {})
    return api.post(f"/worklogs/{log['id']}/actions/authorize", "rpm1", {})
