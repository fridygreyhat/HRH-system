"""Named Central Finance review of newly routed Services."""
from alembic import op
import sqlalchemy as sa

revision = "75c1d9e230fa"
down_revision = "74b0c8d129ef"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("payment_claims", sa.Column("central_reviewer_id", sa.Integer(), nullable=True))
    op.add_column("payment_claims", sa.Column("central_reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key("fk_claim_central_reviewer", "payment_claims", "users", ["central_reviewer_id"], ["id"])
    op.create_index("ix_payment_claims_central_reviewer_id", "payment_claims", ["central_reviewer_id"])


def downgrade():
    op.drop_index("ix_payment_claims_central_reviewer_id", table_name="payment_claims")
    op.drop_constraint("fk_claim_central_reviewer", "payment_claims", type_="foreignkey")
    op.drop_column("payment_claims", "central_reviewed_at")
    op.drop_column("payment_claims", "central_reviewer_id")
