"""CSO Technical Officer role, for hosts where the seed does not run at startup

Revision ID: f1c4d6e8a2b3
Revises: e5b7a90d3c21
"""
from alembic import op
import sqlalchemy as sa

revision = "f1c4d6e8a2b3"
down_revision = "e5b7a90d3c21"
branch_labels = None
depends_on = None

NAME = "CSO_TECHNICAL_OFFICER"
DESCRIPTION = "CSO technical officer: first approval of community-only providers of their CSO, for the cadres in their technical area"


def upgrade():
    op.get_bind().execute(sa.text("INSERT INTO roles (name, description) SELECT :name, :description "
                                  "WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = :name)"), {"name": NAME, "description": DESCRIPTION})


def downgrade():
    op.get_bind().execute(sa.text("DELETE FROM roles WHERE name = :name"), {"name": NAME})
