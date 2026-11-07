"""Record Regional Finance's timesheet approval, separate from the Services payment review.

Revision ID: b4e8f2a61c07
Revises: a7d2c41e9b35
"""
from alembic import op
import sqlalchemy as sa

revision = "b4e8f2a61c07"
down_revision = "a7d2c41e9b35"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("work_logs", sa.Column("finance_timesheet_approved_by", sa.Integer(), nullable=True))
    op.add_column("work_logs", sa.Column("finance_timesheet_approved_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(op.f("fk_work_logs_finance_timesheet_approved_by_users"), "work_logs", "users", ["finance_timesheet_approved_by"], ["id"])


def downgrade():
    op.drop_constraint(op.f("fk_work_logs_finance_timesheet_approved_by_users"), "work_logs", type_="foreignkey")
    op.drop_column("work_logs", "finance_timesheet_approved_at")
    op.drop_column("work_logs", "finance_timesheet_approved_by")
