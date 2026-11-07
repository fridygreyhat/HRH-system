"""Full monthly salary per salary scale, shown in CSO salary files.

Revision ID: c9e1f4d27a10
Revises: b4e8f2a61c07
"""
from alembic import op
import sqlalchemy as sa

revision = "c9e1f4d27a10"
down_revision = "b4e8f2a61c07"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "salary_scale_amounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scale", sa.String(50), nullable=False),
        sa.Column("start_month", sa.String(7), nullable=False),
        sa.Column("monthly_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", name=op.f("fk_salary_scale_amounts_updated_by_users")), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_salary_scale_amounts")),
        sa.UniqueConstraint("scale", "start_month", name=op.f("uq_salary_scale_amounts_scale")),
        sa.CheckConstraint("monthly_amount > 0", name=op.f("ck_salary_scale_amounts_amount")),
    )


def downgrade():
    op.drop_table("salary_scale_amounts")
