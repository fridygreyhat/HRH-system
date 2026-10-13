"""monthly salary on staff, facility-specific rates, claim origin

Revision ID: 9a2f6c3d4e71
Revises: 7d1e4a8b2c60
Create Date: 2026-10-13 09:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9a2f6c3d4e71'
down_revision: Union[str, None] = '7d1e4a8b2c60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The agreed monthly amount a timesheet (SALARY category) claim pays: no rate rule is involved.
    op.add_column('staff', sa.Column('monthly_salary', sa.Numeric(15, 2), nullable=True))
    # Service rates may differ per facility (most specific rule wins: facility > region > national).
    op.add_column('rate_rules', sa.Column('facility_id', sa.Integer(), sa.ForeignKey('facilities.id'), nullable=True))
    # RPM_APPROVAL: created automatically when the RPM approved the work log (the RPM is the first of two people);
    # MANUAL: prepared by finance (a different finance person approves).
    op.add_column('payment_claims', sa.Column('origin', sa.String(20), nullable=False, server_default='MANUAL'))


def downgrade() -> None:
    op.drop_column('payment_claims', 'origin')
    op.drop_column('rate_rules', 'facility_id')
    op.drop_column('staff', 'monthly_salary')
