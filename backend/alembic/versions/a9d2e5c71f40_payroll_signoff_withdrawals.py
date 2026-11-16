"""Take back a signed Payroll month when a timesheet on it is returned, reopened or cancelled

A withdrawal is its own append-only record pointing at the sign-off it takes back; the sign-off itself is never
changed. While its newest sign-off is withdrawn, the CSO sees the region's month as waiting for Regional Finance.

Revision ID: a9d2e5c71f40
Revises: f4b1c8e2d937
"""
import sqlalchemy as sa
from alembic import op

revision = "a9d2e5c71f40"
down_revision = "f4b1c8e2d937"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "finance_monthly_report_withdrawals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_id", sa.Integer(), sa.ForeignKey("finance_monthly_reports.id"), nullable=False, unique=True),
        sa.Column("work_log_id", sa.Integer(), sa.ForeignKey("work_logs.id"), nullable=True),
        sa.Column("withdrawn_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
    )
    op.execute("""CREATE TRIGGER finance_monthly_report_withdrawals_append_only
        BEFORE UPDATE OR DELETE ON finance_monthly_report_withdrawals
        FOR EACH ROW EXECUTE FUNCTION hrh_prevent_modification()""")


def downgrade():
    op.drop_table("finance_monthly_report_withdrawals")
