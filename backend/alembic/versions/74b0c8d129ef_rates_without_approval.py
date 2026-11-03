"""Activate saved rate rules without a separate approval step."""
from alembic import op

revision = "74b0c8d129ef"
down_revision = "66cd441229db"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE rate_rules SET status = 'ACTIVE' WHERE status = 'PENDING_APPROVAL'")
    op.execute("UPDATE rate_rules SET status = 'RETIRED' WHERE status = 'REJECTED'")


def downgrade():
    # Activation was an intentional policy change. Do not invent historical
    # approvers or move rates already used by claims back into a pending state.
    pass
