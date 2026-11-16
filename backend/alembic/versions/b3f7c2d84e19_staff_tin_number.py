"""Taxpayer Identification Number (TIN) on the staff record, optional and unique

Revision ID: b3f7c2d84e19
Revises: a9d2e5c71f40
"""
import sqlalchemy as sa
from alembic import op

revision = "b3f7c2d84e19"
down_revision = "a9d2e5c71f40"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("staff", sa.Column("tin_number", sa.String(11), nullable=True))
    op.create_unique_constraint("uq_staff_tin_number", "staff", ["tin_number"])


def downgrade():
    op.drop_constraint("uq_staff_tin_number", "staff", type_="unique")
    op.drop_column("staff", "tin_number")
