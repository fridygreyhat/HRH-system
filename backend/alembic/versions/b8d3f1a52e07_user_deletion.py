"""Deleting a user account: when and by whom

An account with history keeps its row (the audit trail points to it) but is removed from use: these say when and who.

Revision ID: b8d3f1a52e07
Revises: a6b9e2f17c58
"""
import sqlalchemy as sa
from alembic import op

revision = "b8d3f1a52e07"
down_revision = "a6b9e2f17c58"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("deleted_by", sa.Integer, sa.ForeignKey("users.id", name="fk_users_deleted_by_users")))


def downgrade():
    op.drop_column("users", "deleted_by")
    op.drop_column("users", "deleted_at")
