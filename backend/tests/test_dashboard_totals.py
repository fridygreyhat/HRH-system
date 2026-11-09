"""The dashboard counts in the database: its figures match the rows without loading them."""
from collections import Counter

import pytest
from sqlalchemy import event

from backend.core.security import load_current_user
from backend.db.session import engine
from backend.models import PaymentClaim, Staff, User, WorkLog
from backend.services.scope import claim_visibility, staff_visibility, worklog_visibility
from .test_audit_fixes import chw, periods, worklog  # noqa: F401


@pytest.fixture
def statements():
    seen = []

    def record(conn, cursor, statement, *_):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    yield seen
    event.remove(engine, "before_cursor_execute", record)


def test_the_dashboard_matches_the_records_without_loading_them(api, db, chw, periods, statements):  # noqa: F811
    worklog(db, chw, periods())
    api.token("admin")
    statements.clear()
    report = api.get("/dashboard", "admin")
    # Loading whole rows selects every column. A count(*) wrapper names them too, but returns one number.
    assert not [s for s in statements if not s.startswith("SELECT count(*)") and ("work_logs.created_at" in s or "payment_claims.created_at" in s)]

    current = load_current_user(db, db.query(User).filter_by(username="admin").one())
    logs = db.query(WorkLog).filter(worklog_visibility(current)).all()
    staff = db.query(Staff).filter(staff_visibility(current)).all()
    claims = db.query(PaymentClaim).filter(claim_visibility(current)).all()
    assert logs
    assert report["work_logs"]["by_status"] == dict(Counter(log.status for log in logs))
    assert report["staff"]["total"] == len(staff)
    assert report["staff"]["active"] == sum(1 for person in staff if person.status == "ACTIVE")
    active = {person.id for person in staff if person.status == "ACTIVE"}
    logged = {log.staff_id for log in logs if log.status != "CANCELLED"}
    assert report["work_logs"]["completeness"]["with_log"] == len(active & logged) > 0
    assert sum(bucket["count"] for bucket in report["claims"].values()) == len(claims)
    amounts = [entry["amount"] for bucket in report["claims"].values() for entry in bucket["by_status"].values()]
    assert sum(amounts) == pytest.approx(sum(float(claim.amount) for claim in claims))


def test_the_user_list_takes_the_same_queries_however_many_users_there_are(api, statements):
    api.token("admin")
    statements.clear()
    users = api.get("/admin/users", "admin")
    assert len(users) > 10
    assert len(statements) < 15
    linked = next(user for user in users if user["username"] == "chw1")
    assert linked["staff_id"] and linked["roles"] == ["PROVIDER"]
