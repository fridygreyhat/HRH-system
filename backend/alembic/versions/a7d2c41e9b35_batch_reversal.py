"""Record who reversed a payment batch, when and why.

Revision ID: a7d2c41e9b35
Revises: c3e91b7a4d20
"""
from alembic import op
import sqlalchemy as sa

revision = "a7d2c41e9b35"
down_revision = "c3e91b7a4d20"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("payroll_batches", sa.Column("reversed_by", sa.Integer(), nullable=True))
    op.add_column("payroll_batches", sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("payroll_batches", sa.Column("reversal_reason", sa.Text(), nullable=True))
    op.create_foreign_key(op.f("fk_payroll_batches_reversed_by_users"), "payroll_batches", "users", ["reversed_by"], ["id"])


def downgrade():
    op.drop_constraint(op.f("fk_payroll_batches_reversed_by_users"), "payroll_batches", type_="foreignkey")
    op.drop_column("payroll_batches", "reversal_reason")
    op.drop_column("payroll_batches", "reversed_at")
    op.drop_column("payroll_batches", "reversed_by")
