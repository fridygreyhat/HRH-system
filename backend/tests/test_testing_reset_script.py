"""Exercise the destructive reset only in its own disposable database."""
import uuid
from pathlib import Path
from unittest.mock import patch

import psycopg2
import pytest
from fastapi.testclient import TestClient
from psycopg2 import sql
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker


def test_reset_preserves_admin_and_rejects_ambiguous_admins():
    from backend.core import config
    from backend.db.session import get_db
    from backend.main import app
    from backend.models.base import Base
    from backend.seed import seed

    # Do not use the shared acceptance database: this test deletes everything.
    name = "hrh_test_reset_script_" + uuid.uuid4().hex[:12]
    base = make_url(config.DATABASE_URL)
    connection_args = dict(host=base.host, port=base.port or 5432,
                           user=base.username, password=base.password)
    admin = psycopg2.connect(dbname="postgres", **connection_args)
    admin.autocommit = True
    with admin.cursor() as cursor:
        cursor.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    engine = create_engine(base.set(database=name))
    sessions = sessionmaker(bind=engine)
    reset_sql = (Path(__file__).resolve().parents[2] / "scripts/reset_testing_data.sql").read_text()
    prior_overrides = dict(app.dependency_overrides)

    def isolated_db():
        with sessions() as session:
            yield session

    def reset():
        connection = engine.raw_connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute(reset_sql)
                assert cursor.fetchone() == (1, 0, 0, 0, 0, 0, 0)
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    try:
        Base.metadata.create_all(engine)
        with sessions() as session, patch.object(config, "ADMIN_USERNAME", "reset.admin"), \
                patch.object(config, "ADMIN_PASSWORD", "Reset-test-54321"):
            seed(session)
            session.execute(text("UPDATE users SET must_change_password=false"))
            session.commit()
        app.dependency_overrides[get_db] = isolated_db
        with TestClient(app) as client:
            def login(username):
                result = client.post("/auth/login", data={
                    "username": username, "password": "Reset-test-54321",
                })
                assert result.status_code == 200
                return {"Authorization": "Bearer " + result.json()["access_token"]}

            headers = login("reset.admin")

            def create_user(username, phone, roles):
                response = client.post("/admin/users", headers=headers, json={
                    "username": username, "full_name": "Isolated reset check",
                    "phone": phone, "password": "Reset-test-54321", "roles": roles,
                })
                assert response.status_code == 201, response.status_code
                return response.json()

            retired = create_user("reset.retired", "+255799991011", ["OVERSIGHT"])
            old_headers = login(retired["username"])
            extra_admin = create_user("reset.extra", "+255799991012", ["SUPER_ADMIN"])
            with engine.connect() as connection:
                before_users = connection.scalar(text("SELECT count(*) FROM users"))
                before_regions = connection.scalar(text("SELECT count(*) FROM regions"))
            assert before_regions > 0
            with pytest.raises(psycopg2.Error, match="exactly one active Super Admin"):
                reset()
            with engine.begin() as connection:
                assert connection.scalar(text("SELECT count(*) FROM users")) == before_users
                assert connection.scalar(text("SELECT count(*) FROM regions")) == before_regions
                connection.execute(text("DELETE FROM user_roles WHERE user_id=:id"), {"id": extra_admin["id"]})
                protected = dict(connection.execute(text(
                    "SELECT * FROM users WHERE username='reset.admin'"
                )).mappings().one())
                grants = connection.execute(text(
                    "SELECT role_id FROM user_roles WHERE user_id=:id ORDER BY role_id"
                ), {"id": protected["id"]}).scalars().all()
                previous_max_id = connection.scalar(text("SELECT max(id) FROM users"))

            reset()
            with engine.connect() as connection:
                remaining = dict(connection.execute(text("SELECT * FROM users")).mappings().one())
                # Compare through a boolean so a failure never prints account fields.
                unchanged = remaining == protected
                assert unchanged, "Reset changed the protected account"
                assert connection.execute(text(
                    "SELECT role_id FROM user_roles ORDER BY role_id"
                )).scalars().all() == grants
                assert connection.scalar(text("SELECT count(*) FROM roles")) > 1
            assert client.get("/auth/me", headers=headers).status_code == 200
            assert client.get("/auth/me", headers=old_headers).status_code == 401
            fresh = create_user("reset.new", "+255799991013", ["OVERSIGHT"])
            assert fresh["id"] > previous_max_id
            assert client.get("/auth/me", headers=old_headers).status_code == 401
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(prior_overrides)
        engine.dispose()
        with admin.cursor() as cursor:
            cursor.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
        admin.close()
