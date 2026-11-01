from unittest.mock import patch

import pytest

from scripts.prepare_production_admin import build_sql, write_private


def test_sql_requires_empty_users_and_contains_only_admin_and_system_roles():
    sql = build_sql("synthetic-hash-for-test-only")
    assert "IF EXISTS (SELECT 1 FROM public.users)" in sql
    assert "No account was changed." in sql
    assert "('admin', 'synthetic-hash-for-test-only'" in sql
    assert "('SYSTEM_ADMIN', 'SUPER_ADMIN')" in sql
    assert "must_change_password" in sql
    for forbidden in ("CREATE TABLE", "ALTER TABLE", "INSERT INTO public.staff",
                      "INSERT INTO public.work_logs", "INSERT INTO public.pay_periods"):
        assert forbidden not in sql


def test_private_sql_replacement_is_complete_and_private(tmp_path):
    target = tmp_path / "private" / "setup.sql"
    write_private(target, "complete-sql")
    assert target.read_text() == "complete-sql"
    assert target.stat().st_mode & 0o777 == 0o600
    assert list(target.parent.iterdir()) == [target]


def test_failed_replacement_preserves_existing_file_and_removes_temporary(tmp_path):
    target = tmp_path / "setup.sql"
    target.write_text("previous-complete-sql")
    with patch("scripts.prepare_production_admin.os.replace", side_effect=OSError):
        with pytest.raises(OSError):
            write_private(target, "new-complete-sql")
    assert target.read_text() == "previous-complete-sql"
    assert list(tmp_path.iterdir()) == [target]
