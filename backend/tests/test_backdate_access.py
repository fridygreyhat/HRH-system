"""Three-day boundary and scoped, expiring technical exceptions for all cadres."""
from datetime import date, datetime, time, timedelta

import pytest

from .conftest import ENTRY


@pytest.fixture
def deadline(db):
    from backend.models import SystemSetting
    row = db.get(SystemSetting, "backdate_grace_hours")
    previous = row.value
    row.value = 72
    db.commit()
    yield
    row.value = previous
    db.commit()


def staff_id(db, username):
    from backend.models import Staff, User
    return db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == username).one().id


@pytest.mark.parametrize("cadre,username", [("CHW", "chw1"), ("HCP", "hcp1"), ("DATA_CLERK", "clerk1")])
def test_late_missing_day_requires_technical_permission(api, db, period, deadline, cadre, username):
    from backend.models import AuditEvent, WorkLogAudit
    log = api.post("/worklogs", username, {"period_id": period["id"]})
    day = period["start_date"]
    path = f"/worklogs/{log['id']}/entries/{day}"
    body = ENTRY[cadre](None)
    api.put(path, username, body, expect=422)
    provider_id = staff_id(db, username)
    listed = api.get(f"/backdate-access?entry_date={day}", "tofficer1")
    assert provider_id in {row["id"] for row in listed["providers"]}
    grant = api.post("/backdate-access", "tofficer1", {
        "staff_id": provider_id, "entry_date": day, "valid_hours": 24, "reason": "Approved missing timesheet entry"})
    assert grant["status"] == "ACTIVE"
    saved = api.put(path, username, body)
    assert len(saved["entries"]) == 1
    assert saved["backdate_access"]["grants"][0]["entry_date"] == day
    assert db.query(AuditEvent).filter_by(entity_type="backdate_access", entity_id=str(grant["id"]), action="grant").count() == 1
    audit = db.query(WorkLogAudit).filter_by(work_log_id=log["id"], action="edit_entry").order_by(WorkLogAudit.id.desc()).first()
    assert audit.details["backdate_access_id"] == grant["id"]
    api.call("DELETE", f"/backdate-access/{grant['id']}", "tofficer1")
    # Corrections to existing days remain possible after expiry/revocation.
    api.put(path, username, body)
    api.call("DELETE", path, username)
    api.put(path, username, body, expect=422)


@pytest.mark.parametrize("cadre,username", [("CHW", "chw1"), ("HCP", "hcp1"), ("DATA_CLERK", "clerk1")])
def test_exact_72_hour_boundary(api, db, period, deadline, monkeypatch, cadre, username):
    from backend.api.endpoints import worklogs
    log = api.post("/worklogs", username, {"period_id": period["id"]})
    day = date.fromisoformat(period["start_date"])
    body = ENTRY[cadre](None)
    completion = time.max if cadre == "CHW" else time.fromisoformat(body["end_time"])
    boundary = datetime.combine(day, completion, tzinfo=worklogs.TZ) + timedelta(hours=72)
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return boundary
    monkeypatch.setattr(worklogs, "datetime", FrozenDateTime)
    path = f"/worklogs/{log['id']}/entries/{day}"
    api.put(path, username, body)
    api.call("DELETE", path, username)
    boundary += timedelta(microseconds=1)
    api.put(path, username, body, expect=422)


def test_expiry_scope_and_date_do_not_leak_access(api, db, period, deadline):
    from backend.models import BackdateAccess, User, UserReviewCadre, utcnow
    day = date.fromisoformat(period["start_date"])
    provider_id = staff_id(db, "hcp1")
    payload = {"staff_id": provider_id, "entry_date": str(day), "reason": "Approved exception for missed date"}
    api.post("/backdate-access", "hcp1", payload, expect=403)
    api.post("/backdate-access", "rpm1", payload, expect=403)
    # Removing the technical cadre grant must remove both read and write access.
    officer = db.query(User).filter_by(username="tofficer1").one()
    from backend.models import Staff
    cadre_id = db.get(Staff, provider_id).cadre_id
    db.query(UserReviewCadre).filter_by(user_id=officer.id, cadre_id=cadre_id).delete()
    db.commit()
    try:
        api.post("/backdate-access", "tofficer1", payload, expect=403)
        assert provider_id not in {p["id"] for p in api.get(f"/backdate-access?entry_date={day}", "tofficer1")["providers"]}
    finally:
        db.add(UserReviewCadre(user_id=officer.id, cadre_id=cadre_id)); db.commit()
    grant = api.post("/backdate-access", "tofficer1", payload)
    log = api.post("/worklogs", "hcp1", {"period_id": period["id"]})
    body = ENTRY["HCP"](None)
    api.put(f"/worklogs/{log['id']}/entries/{day + timedelta(days=1)}", "hcp1", body, expect=422)
    row = db.get(BackdateAccess, grant["id"])
    row.expires_at = utcnow() - timedelta(seconds=1); db.commit()
    api.put(f"/worklogs/{log['id']}/entries/{day}", "hcp1", body, expect=422)
    assert api.get(f"/backdate-access?entry_date={day}", "tofficer1")["grants"][0]["status"] == "EXPIRED"


def test_grants_do_not_bypass_hour_limits_or_closed_periods(api, db, period, deadline):
    from backend.models import PayPeriod
    day = period["start_date"]
    log = api.post("/worklogs", "chw1", {"period_id": period["id"]})
    payload = {"staff_id": staff_id(db, "chw1"), "entry_date": day, "reason": "Approved exceptional entry"}
    grant = api.post("/backdate-access", "tofficer1", payload)
    api.put(f"/worklogs/{log['id']}/entries/{day}", "chw1", {**ENTRY["CHW"](None), "hours_worked": 10}, expect=422)
    row = db.get(PayPeriod, period["id"]); row.status = "CLOSED"; db.commit()
    api.put(f"/worklogs/{log['id']}/entries/{day}", "chw1", ENTRY["CHW"](None), expect=409)
    api.call("DELETE", f"/backdate-access/{grant['id']}", "hcp1", expect=403)
