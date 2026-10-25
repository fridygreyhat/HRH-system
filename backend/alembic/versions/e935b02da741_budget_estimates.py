"""Separate optional planning estimates from enforceable budget caps."""
from alembic import op
import sqlalchemy as sa

revision = "e935b02da741"
down_revision = "d824a91cf630"
branch_labels = None
depends_on = None


def upgrade():
    # NULL means no projection was supplied. Do not invent historical estimates.
    op.add_column("budget_lines", sa.Column("estimated_amount", sa.Numeric(15, 2), nullable=True))
    op.create_check_constraint(
        op.f("ck_budget_lines_estimate_within_cap"), "budget_lines",
        "estimated_amount IS NULL OR (estimated_amount >= 0 AND estimated_amount <= allocated_amount)",
    )


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM budget_lines WHERE estimated_amount IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("Budget estimates are configured; do not discard financial planning history")
    op.drop_constraint(op.f("ck_budget_lines_estimate_within_cap"), "budget_lines", type_="check")
    op.drop_column("budget_lines", "estimated_amount")
