"""The first Data Clerk questions the current form replaced are hidden, never offered, and old records still read."""
from types import SimpleNamespace

from backend.services.data_clerk_forms import DATA_CLERK_RETIRED_FIELDS


def _clerk(db):
    from backend.models import Staff, StaffAssignment, User
    staff = db.query(Staff).join(User, User.id == Staff.user_id).filter(User.username == "clerk1").one()
    return staff, db.query(StaffAssignment).filter_by(staff_id=staff.id).first()


def test_retired_questions_are_hidden_but_kept(api, db):
    from backend.models import Cadre, CadreFormField
    clerk = db.query(Cadre).filter_by(code="DATA_CLERK").one()
    rows = {f.key: f.is_active for f in db.query(CadreFormField).filter_by(cadre_id=clerk.id)}
    assert {key: rows[key] for key in DATA_CLERK_RETIRED_FIELDS} == dict.fromkeys(DATA_CLERK_RETIRED_FIELDS, False)
    # Administrators still see them (hidden), so they can be reviewed or shown again; providers never do.
    admin = next(c for c in api.get("/admin/cadres", "admin") if c["code"] == "DATA_CLERK")
    assert {f["key"]: f["is_active"] for f in admin["fields"] if f["key"] in DATA_CLERK_RETIRED_FIELDS} \
        == dict.fromkeys(DATA_CLERK_RETIRED_FIELDS, False)
    provider = next(c for c in api.get("/admin/cadres", "clerk1") if c["code"] == "DATA_CLERK")
    assert not DATA_CLERK_RETIRED_FIELDS & {f["key"] for f in provider["fields"]}


def test_current_data_clerk_forms_never_ask_retired_questions(db, request):
    from backend.models import PayPeriod
    from backend.services.activity_catalog import catalog_for_log, log_fields
    staff, assignment = _clerk(db)
    # Any pay month will do. Reuse one: each new test month goes further back and the suite nearly reaches year 2000.
    existing = db.query(PayPeriod.id).order_by(PayPeriod.id).first()
    period_id = existing.id if existing else request.getfixturevalue("period")["id"]
    for work_type in ("PAYROLL", "SERVICES"):
        log = SimpleNamespace(id=-1, cadre_id=staff.cadre_id, assignment_id=assignment.id, period_id=period_id,
                              work_type=work_type, workflow_version=2)
        asked = {f["key"] for item in catalog_for_log(db, log) for f in item.get("field_definitions", [])}
        assert not asked & DATA_CLERK_RETIRED_FIELDS, work_type
        assert not {f.key for f in log_fields(db, log)} & DATA_CLERK_RETIRED_FIELDS
    # An older first-generation draft keeps the questions it was designed with, so it can still be corrected.
    legacy = SimpleNamespace(id=-1, cadre_id=staff.cadre_id, workflow_version=1)
    assert DATA_CLERK_RETIRED_FIELDS <= {f.key for f in log_fields(db, legacy)}


def test_the_retirement_step_hides_them_on_an_existing_database(db):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from backend.models import Cadre, CadreFormField
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "f4b1c8e2d937_retire_old_data_clerk_questions.py"
    spec = importlib.util.spec_from_file_location("retire_step", path)
    step = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(step)
    assert set(step.RETIRED) == DATA_CLERK_RETIRED_FIELDS
    clerk = db.query(Cadre).filter_by(code="DATA_CLERK").one().id
    query = db.query(CadreFormField).filter(CadreFormField.cadre_id == clerk, CadreFormField.key.in_(DATA_CLERK_RETIRED_FIELDS))
    connection = db.connection()
    with Operations.context(MigrationContext.configure(connection)):
        step.downgrade()
        db.expire_all()
        assert all(f.is_active for f in query)
        step.upgrade()
        db.expire_all()
        assert not any(f.is_active for f in query)
    db.rollback()
    # Other cadres' questions are untouched.
    assert db.query(CadreFormField).filter(CadreFormField.cadre_id != clerk, CadreFormField.is_active.is_(False)).count() == 0
