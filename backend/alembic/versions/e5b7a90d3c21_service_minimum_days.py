"""minimum days per month on each service

Revision ID: e5b7a90d3c21
Revises: d2f6a83c1e47
"""
import sqlalchemy as sa
from alembic import op

revision = "e5b7a90d3c21"
down_revision = "d2f6a83c1e47"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("activity_rates", sa.Column("min_days_per_month", sa.Integer(), nullable=True))
    op.create_check_constraint(op.f("ck_activity_rates_min_days"), "activity_rates", "min_days_per_month BETWEEN 0 AND 31")


def downgrade():
    op.drop_constraint(op.f("ck_activity_rates_min_days"), "activity_rates", type_="check")
    op.drop_column("activity_rates", "min_days_per_month")
