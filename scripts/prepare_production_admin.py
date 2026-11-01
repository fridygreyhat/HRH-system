"""Prepare private, data-only SQL for an explicitly approved empty database.

This manual utility never connects to a database and is not a startup hook.
"""

import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.core.roles import ROLE_DESCRIPTIONS
from backend.core.security import hash_password


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_sql(password_hash: str) -> str:
    roles = ",\n".join(
        f"    ({literal(name)}, {literal(description)})"
        for name, description in ROLE_DESCRIPTIONS.items()
    )
    return """-- PRIVATE: contains a password hash. Do not commit, publish or share.
-- Run this ENTIRE file in the Production SQL console, once.
-- No schema changes or demo records. Existing accounts are never overwritten.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';
LOCK TABLE public.users, public.roles, public.user_roles IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM public.users) THEN
        RAISE EXCEPTION 'Setup refused: users already exist. No account was changed.';
    END IF;
END;
$guard$;
INSERT INTO public.roles (name, description) VALUES
""" + roles + """
ON CONFLICT (name) DO NOTHING;
WITH new_admin AS (
    INSERT INTO public.users
        (username, hashed_password, full_name, phone, preferred_language,
         is_active, created_at, failed_login_count, must_change_password,
         password_changed_at)
    VALUES ('admin', """ + literal(password_hash) + """, 'System Administrator', '', 'en',
            TRUE, CURRENT_TIMESTAMP, 0, TRUE, CURRENT_TIMESTAMP)
    RETURNING id
)
INSERT INTO public.user_roles (user_id, role_id, assigned_by, assigned_at)
SELECT new_admin.id, r.id, NULL, CURRENT_TIMESTAMP
FROM new_admin CROSS JOIN public.roles r
WHERE r.name IN ('SYSTEM_ADMIN', 'SUPER_ADMIN');
DO $verify$
BEGIN
    IF (SELECT count(*) FROM public.users WHERE username='admin' AND is_active) <> 1
       OR (SELECT count(*) FROM public.user_roles ur
           JOIN public.users u ON u.id=ur.user_id
           JOIN public.roles r ON r.id=ur.role_id
           WHERE u.username='admin' AND r.name IN ('SYSTEM_ADMIN','SUPER_ADMIN')) <> 2 THEN
        RAISE EXCEPTION 'Setup failed verification; transaction must be rolled back.';
    END IF;
END;
$verify$;
COMMIT;
SELECT u.username, u.is_active, u.must_change_password,
       string_agg(r.name, ', ' ORDER BY r.name) AS roles
FROM public.users u
JOIN public.user_roles ur ON ur.user_id=u.id
JOIN public.roles r ON r.id=ur.role_id
WHERE u.username='admin'
GROUP BY u.id, u.username, u.is_active, u.must_change_password;
"""


def write_private(destination: Path, content: str) -> None:
    """Replace atomically so a failed preparation cannot truncate an old file."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=destination.parent,
            prefix=".admin-setup-", suffix=".tmp", delete=False,
        ) as output:
            temporary = Path(output.name)
            os.chmod(temporary, 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    password = os.environ.get("ADMIN_PASSWORD")
    if not password or len(password) < 8:
        raise SystemExit("Set ADMIN_PASSWORD securely to at least eight characters.")
    if len(password.encode("utf-8")) > 72:
        raise SystemExit("ADMIN_PASSWORD must not exceed 72 UTF-8 bytes.")
    destination = ROOT / ".data" / "production-admin-setup.sql"
    write_private(destination, build_sql(hash_password(password)))
    print("Prepared private file: .data/production-admin-setup.sql")
    print("No plaintext password was written. No database was modified.")


if __name__ == "__main__":
    main()
