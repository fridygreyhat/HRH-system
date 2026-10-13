"""session version: signing out ends the session on the server

Revision ID: 7d1e4a8b2c60
Revises: 5b7e2c9d1f30
Create Date: 2026-10-12 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7d1e4a8b2c60'
down_revision: Union[str, None] = '5b7e2c9d1f30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('session_version', sa.Integer(), nullable=False, server_default=sa.text('0')))


def downgrade() -> None:
    op.drop_column('users', 'session_version')
