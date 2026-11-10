"""Backdate access may cover a range of dates

Revision ID: e2c7a9d4b618
Revises: d6b3f9a2c517
"""
import sqlalchemy as sa
from alembic import op

revision = "e2c7a9d4b618"
down_revision = "d6b3f9a2c517"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("backdate_access", sa.Column("end_date", sa.Date(), nullable=True))
    op.create_check_constraint("ck_backdate_access_range", "backdate_access", "end_date IS NULL OR end_date >= entry_date")


def downgrade():
    op.drop_constraint("ck_backdate_access_range", "backdate_access", type_="check")
    op.drop_column("backdate_access", "end_date")
