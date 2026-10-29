"""Append-only monthly regional report sign-offs, separate from payment approval."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "29c704e26523"
down_revision = "18b6f30d5412"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("finance_monthly_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("region_id", sa.Integer(), sa.ForeignKey("regions.id"), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("work_type", sa.String(16), nullable=False),
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False))
    op.create_index("ix_finance_monthly_report_lookup", "finance_monthly_reports",
                    ["region_id", "month", "work_type", "id"])
    op.execute("""CREATE TRIGGER finance_monthly_reports_append_only
        BEFORE UPDATE OR DELETE ON finance_monthly_reports
        FOR EACH ROW EXECUTE FUNCTION hrh_prevent_modification()""")


def downgrade():
    op.drop_table("finance_monthly_reports")
