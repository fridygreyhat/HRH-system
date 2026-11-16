"""Wrong sign-ins per username and device, so one device's guesses cannot lock everyone else out

Revision ID: c8e1a4f60b27
Revises: b3f7c2d84e19
"""
import sqlalchemy as sa
from alembic import op

revision = "c8e1a4f60b27"
down_revision = "b3f7c2d84e19"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "login_failures",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("client", sa.String(64), nullable=False),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_login_failures_username_at", "login_failures", ["username", "failed_at"])


def downgrade():
    op.drop_table("login_failures")
