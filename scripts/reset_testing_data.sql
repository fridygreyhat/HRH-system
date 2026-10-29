-- DESTRUCTIVE: run manually only for an explicitly approved full testing reset.
-- This script is NOT invoked by Git pull, application startup or publishing.
-- It deletes every business/setup/history row and every non-Super-Admin user.
-- It preserves the one active Super Admin, their password and role permissions,
-- system role definitions (needed to create new accounts), and schema metadata.
-- Run the ENTIRE script in one SQL-console execution. Never run only a section.
-- Make a backup or checkpoint before execution. No database schema is changed.
-- Identity sequences are deliberately NOT reset: old login tokens must never
-- acquire access to a new user whose numeric ID was recycled.

BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';
LOCK TABLE public.users, public.user_roles, public.roles IN ACCESS EXCLUSIVE MODE;

DO $reset$
DECLARE
    retained_id integer;
    super_count integer;
    original_user jsonb;
    original_grants integer[];
    remaining_grants integer[];
    table_list text;
    item record;
    row_count bigint;
BEGIN
    SELECT count(DISTINCT u.id), min(u.id)
      INTO super_count, retained_id
      FROM public.users u
      JOIN public.user_roles ur ON ur.user_id = u.id
      JOIN public.roles r ON r.id = ur.role_id
     WHERE r.name = 'SUPER_ADMIN' AND u.is_active;

    IF super_count <> 1 THEN
        RAISE EXCEPTION 'Reset refused: expected exactly one active Super Admin';
    END IF;

    SELECT to_jsonb(u) INTO original_user
      FROM public.users u WHERE u.id = retained_id;
    SELECT array_agg(role_id ORDER BY role_id) INTO original_grants
      FROM public.user_roles WHERE user_id = retained_id;

    SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
      INTO table_list
      FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('users', 'roles', 'user_roles', 'alembic_version');
    IF table_list IS NULL THEN
        RAISE EXCEPTION 'Reset refused: application tables not found';
    END IF;

    EXECUTE 'TRUNCATE TABLE ' || table_list;
    DELETE FROM public.user_roles WHERE user_id <> retained_id;
    UPDATE public.user_roles SET assigned_by = NULL
     WHERE assigned_by IS NOT NULL AND assigned_by <> retained_id;
    DELETE FROM public.users WHERE id <> retained_id;

    SELECT array_agg(role_id ORDER BY role_id) INTO remaining_grants
      FROM public.user_roles WHERE user_id = retained_id;
    IF (SELECT to_jsonb(u) FROM public.users u WHERE u.id = retained_id)
           IS DISTINCT FROM original_user
       OR remaining_grants IS DISTINCT FROM original_grants THEN
        RAISE EXCEPTION 'Reset rolled back: protected Super Admin changed';
    END IF;

    FOR item IN
        SELECT schemaname, tablename FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename NOT IN ('users', 'roles', 'user_roles', 'alembic_version')
    LOOP
        EXECUTE format('SELECT count(*) FROM %I.%I', item.schemaname, item.tablename)
           INTO row_count;
        IF row_count <> 0 THEN
            RAISE EXCEPTION 'Reset rolled back: application data remains';
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.users) <> 1 THEN
        RAISE EXCEPTION 'Reset rolled back: unexpected user count';
    END IF;
END;
$reset$;
COMMIT;

SELECT
    (SELECT count(*) FROM public.users) AS users_remaining,
    (SELECT count(*) FROM public.staff) AS staff,
    (SELECT count(*) FROM public.work_logs) AS work_logs,
    (SELECT count(*) FROM public.payment_claims) AS claims,
    (SELECT count(*) FROM public.audit_events) AS audit_history,
    (SELECT count(*) FROM public.regions) AS regions,
    (SELECT count(*) FROM public.cadres) AS cadres;
