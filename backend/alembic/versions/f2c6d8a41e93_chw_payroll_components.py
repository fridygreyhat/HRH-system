"""CHW payroll: stipend, transport and communication parts of the monthly amount

A salary amount may list the parts that make up its monthly amount. Every CHW is paid the CHW package; until Central
Finance saves one, it is 100,000 stipend + 30,000 transport + 20,000 communication = 150,000 TZS a month (in code).

Revision ID: f2c6d8a41e93
Revises: e7a3c9d15b42
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "f2c6d8a41e93"
down_revision = "e7a3c9d15b42"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("salary_scale_amounts", sa.Column("components", JSONB))


def downgrade():
    op.drop_column("salary_scale_amounts", "components")
