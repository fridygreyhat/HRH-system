"""Add daily activity selections to work logs.

Revision ID: 2b4ac618f932
Revises: 3e1a9d7c42b6
"""
from alembic import op
import sqlalchemy as sa

revision = "2b4ac618f932"
down_revision = "3e1a9d7c42b6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("work_log_entries", sa.Column("activity_key", sa.String(length=80), nullable=True))
    op.add_column("work_log_entries", sa.Column("activity_location", sa.String(length=255), nullable=True))


def downgrade():
    op.drop_column("work_log_entries", "activity_location")
    op.drop_column("work_log_entries", "activity_key")
