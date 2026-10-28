"""Payroll finishes at RM approval; preserve committed/historical financial records."""
from alembic import op
import sqlalchemy as sa

revision = "07a5e29c4301"
down_revision = "f046c13ab852"
branch_labels = None
depends_on = None


def upgrade():
    # Only retire uncommitted proposals. Never reverse money, budgets or paid claims.
    op.execute(sa.text("""
        WITH candidates AS MATERIALIZED (
            SELECT l.id FROM work_logs l
            WHERE l.work_type = 'PAYROLL' AND l.workflow_version >= 2
              AND l.status = 'PENDING_FINANCE_REVIEW' AND l.approved_at IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM payment_claims c WHERE c.work_log_id = l.id
                    AND c.status <> 'CANCELLED'
                    AND NOT (c.status = 'PENDING_FINANCE_REVIEW'
                             AND c.payment_status = 'NOT_STARTED'
                             AND c.budget_line_id IS NULL AND c.batch_id IS NULL
                             AND NOT EXISTS (SELECT 1 FROM budget_transactions t WHERE t.claim_id = c.id)
                             AND NOT EXISTS (SELECT 1 FROM payment_records p WHERE p.claim_id = c.id))
              )
        ), retired AS (
            UPDATE payment_claims SET status = 'CANCELLED', updated_at = now()
            WHERE work_log_id IN (SELECT id FROM candidates)
              AND status = 'PENDING_FINANCE_REVIEW'
            RETURNING id, payment_status
        ), claim_history AS (
            INSERT INTO claim_audit
                (claim_id, actor_role, action, old_status, new_status,
                 old_payment_status, new_payment_status, comment, timestamp)
            SELECT id, 'SYSTEM', 'payroll_reporting_policy', 'PENDING_FINANCE_REVIEW', 'CANCELLED',
                   payment_status, payment_status,
                   'Uncommitted proposal retired: Payroll requires work approval only.', now()
            FROM retired RETURNING id
        ), changed AS (
            UPDATE work_logs SET status = 'APPROVED', status_changed_at = now(),
                                 updated_at = now(), finance_snapshot = NULL, routed_channel = NULL
            WHERE id IN (SELECT id FROM candidates)
            RETURNING id, version
        )
        INSERT INTO work_log_audit
            (work_log_id, version, actor_role, action, old_status, new_status, comment, timestamp)
        SELECT id, version, 'SYSTEM', 'payroll_reporting_policy', 'PENDING_FINANCE_REVIEW', 'APPROVED',
               'RM approval retained; Payroll is a work report without finance approval or budget requirements.', now()
        FROM changed
    """))
    # Old RM budget holds have no place in Payroll's operational-only approval.
    # Return uncommitted/unapproved holds to RM; do not approve work on its behalf.
    op.execute(sa.text("""
        WITH changed AS (
            UPDATE work_logs l SET status = 'PENDING_RPM_AUTHORIZATION',
                   status_changed_at = now(), updated_at = now()
            WHERE l.work_type = 'PAYROLL' AND l.status = 'BUDGET_HOLD'
              AND l.approved_at IS NULL AND l.finance_snapshot IS NULL
              AND NOT EXISTS (SELECT 1 FROM payment_claims c
                              WHERE c.work_log_id = l.id AND c.status <> 'CANCELLED')
            RETURNING l.id, l.version
        )
        INSERT INTO work_log_audit
            (work_log_id, version, actor_role, action, old_status, new_status, comment, timestamp)
        SELECT id, version, 'SYSTEM', 'payroll_reporting_policy', 'BUDGET_HOLD',
               'PENDING_RPM_AUTHORIZATION', 'Payroll budget hold removed; RM work approval is still required.', now()
        FROM changed
    """))


def downgrade():
    raise RuntimeError("Payroll reporting policy cannot be reversed by rewriting approvals or append-only history.")
