"""Allow new RPM-prepared liabilities to await Finance category selection."""
from alembic import op
import sqlalchemy as sa

revision = "92a64d7e301b"
down_revision = "81e73c4a9210"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("payment_claims", "category_id", existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint(
        "pending_finance_category", "payment_claims",
        "category_id IS NOT NULL OR (workflow_version >= 2 AND work_log_id IS NOT NULL "
        "AND status IN ('PENDING_FINANCE_REVIEW', 'CANCELLED'))",
    )


def downgrade():
    # Refuse a downgrade that would discard uncategorized liabilities or history.
    op.alter_column("payment_claims", "category_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint(op.f("ck_payment_claims_pending_finance_category"), "payment_claims", type_="check")
