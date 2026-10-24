"""Use the authoritative BUDGET_HOLD status for claims.

Revision ID: 42bc8f61e09a
Revises: 2b4ac618f932
"""
from alembic import op

revision = "42bc8f61e09a"
down_revision = "2b4ac618f932"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE payment_claims SET status = 'BUDGET_HOLD' WHERE status = 'HELD'")


def downgrade():
    op.execute("UPDATE payment_claims SET status = 'HELD' WHERE status = 'BUDGET_HOLD'")
