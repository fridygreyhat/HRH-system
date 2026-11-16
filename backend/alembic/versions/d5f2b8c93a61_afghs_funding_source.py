"""Add the AFGHS funding source beside PnP, Supply Chain and EpiC

Added only where no funding source with this code or name exists yet, so an install that already has it is unchanged.

Revision ID: d5f2b8c93a61
Revises: c8e1a4f60b27
"""
import sqlalchemy as sa
from alembic import op

revision = "d5f2b8c93a61"
down_revision = "c8e1a4f60b27"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        INSERT INTO funding_sources (code, name)
        SELECT 'AFGHS', 'AFGHS'
        WHERE NOT EXISTS (
            SELECT 1 FROM funding_sources existing
            WHERE upper(existing.code) = 'AFGHS' OR lower(trim(existing.name)) = 'afghs'
        )
    """))


def downgrade():
    # Funding sources are referenced by reviewed claims and budgets: never removed by a schema step.
    pass
