"""SMS code required before a provider's payment details change

Revision ID: b7d2c4e9f105
Revises: a3f9e2c7d814
"""
import sqlalchemy as sa
from alembic import op

revision = "b7d2c4e9f105"
down_revision = "a3f9e2c7d814"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "payment_details_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=False),
        sa.Column("code_hash", sa.String(128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("is_used", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(op.f("ix_payment_details_codes_staff_id"), "payment_details_codes", ["staff_id"])


def downgrade():
    op.drop_index(op.f("ix_payment_details_codes_staff_id"), table_name="payment_details_codes")
    op.drop_table("payment_details_codes")
