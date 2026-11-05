"""server-side sign-out, one all-region budget line per code, normalized form types

Revision ID: c3e91b7a4d20
Revises: 78f40c16532d
Create Date: 2026-11-05 09:00:00.000000
"""
import json
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3e91b7a4d20'
down_revision: Union[str, None] = '78f40c16532d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    op.add_column('users', sa.Column('session_version', sa.Integer(), nullable=False, server_default=sa.text('0')))

    # Form types are matched exactly, so a category saved as `salary` was treated as an unknown type.
    op.execute("UPDATE claim_categories SET form_type = NULLIF(upper(btrim(form_type)), '') WHERE form_type IS DISTINCT FROM NULLIF(upper(btrim(form_type)), '')")

    # Existing duplicates keep their money and history: the oldest keeps the code, later ones get a visible suffix.
    conn = op.get_bind()
    duplicates = conn.execute(sa.text("""
        SELECT id, code FROM (
            SELECT id, code, row_number() OVER (PARTITION BY code, organization_id, period_id ORDER BY id) AS n
            FROM budget_lines WHERE region_id IS NULL
        ) ranked WHERE n > 1
    """)).all()
    for line_id, code in duplicates:
        renamed = f"{code[:80]}-DUP-{line_id}"
        conn.execute(sa.text("UPDATE budget_lines SET code = :code WHERE id = :id"), {"code": renamed, "id": line_id})
        conn.execute(
            sa.text("""
                INSERT INTO audit_events (actor_roles, entity_type, entity_id, action, before, after, reason, created_at)
                VALUES ('SYSTEM', 'budget_line', :id, 'rename_duplicate', CAST(:before AS JSONB), CAST(:after AS JSONB), :reason, now())
            """),
            {"id": str(line_id), "before": json.dumps({"code": code}), "after": json.dumps({"code": renamed}),
             "reason": "Duplicate all-region budget line renamed by migration c3e91b7a4d20"},
        )
        logger.warning("Duplicate all-region budget line %s renamed from %s to %s: review it", line_id, code, renamed)
    op.create_index(
        'uq_budget_lines_all_regions', 'budget_lines', ['code', 'organization_id', 'period_id'],
        unique=True, postgresql_where=sa.text('region_id IS NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_budget_lines_all_regions', table_name='budget_lines')
    op.drop_column('users', 'session_version')
