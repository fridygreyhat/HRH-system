"""public holidays announced each year

Revision ID: d2f6a83c1e47
Revises: c9e1f4d27a10
"""
import sqlalchemy as sa
from alembic import op

revision = "d2f6a83c1e47"
down_revision = "c9e1f4d27a10"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "public_holidays",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("holiday_date", sa.Date(), nullable=False),
        sa.Column("name_en", sa.String(100), nullable=False),
        sa.Column("name_sw", sa.String(100), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", name=op.f("fk_public_holidays_created_by_users")), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_public_holidays")),
        sa.UniqueConstraint("holiday_date", name=op.f("uq_public_holidays_holiday_date")),
    )


def downgrade():
    op.drop_table("public_holidays")
