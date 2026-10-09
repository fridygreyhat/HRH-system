"""technical review by cadre

Revision ID: 3e1a9d7c42b6
Revises: 8c4f1071a14a
Create Date: 2026-10-09 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3e1a9d7c42b6'
down_revision: Union[str, None] = '8c4f1071a14a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TITLES = {
    'CHW': 'Senior Regional Technical Officer, Community Engagement',
    'DATA_CLERK': 'Regional Strategic Information Officer',
    'HCP': 'Senior Regional Technical Officer, Care & Treatment',
}


def upgrade() -> None:
    op.add_column('cadres', sa.Column('technical_reviewer_title', sa.String(length=255), nullable=True))
    for code, title in TITLES.items():
        op.execute(sa.text("UPDATE cadres SET technical_reviewer_title = :title WHERE code = :code").bindparams(title=title, code=code))
    op.create_table(
        'user_review_cadres',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), primary_key=True),
        sa.Column('cadre_id', sa.Integer(), sa.ForeignKey('cadres.id'), primary_key=True),
        sa.Column('assigned_by', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('user_review_cadres')
    op.drop_column('cadres', 'technical_reviewer_title')
