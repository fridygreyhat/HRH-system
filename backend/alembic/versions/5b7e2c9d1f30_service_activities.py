"""service activities on the daily work log

Services (SNS testing, index testing, ...) are counted on the same daily form as the timesheet and paid by
FHI360 per client. Each is a cadre form field flagged is_service, one row per cadre that may record it.

Revision ID: 5b7e2c9d1f30
Revises: 3e1a9d7c42b6
Create Date: 2026-10-12 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5b7e2c9d1f30'
down_revision: Union[str, None] = '3e1a9d7c42b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The starting services are added by the seed, which runs after migrations and creates the cadres.
    op.add_column('cadre_form_fields', sa.Column('is_service', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('cadre_form_fields', 'is_service')
