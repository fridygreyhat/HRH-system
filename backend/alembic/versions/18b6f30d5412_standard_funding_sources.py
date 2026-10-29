"""Add programme funding choices without changing existing categories or budgets."""
from alembic import op
import sqlalchemy as sa

revision = "18b6f30d5412"
down_revision = "07a5e29c4301"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        INSERT INTO funding_sources (code, name)
        SELECT programme.code, programme.name
        FROM (VALUES ('PNP', 'PnP'), ('SUPPLY_CHAIN', 'Supply Chain'), ('EPIC', 'EpiC'))
             AS programme(code, name)
        WHERE NOT EXISTS (
            SELECT 1 FROM funding_sources existing
            WHERE upper(existing.code) = upper(programme.code)
               OR lower(trim(existing.name)) = lower(programme.name)
        )
    """))


def downgrade():
    # These become user-referenced catalogue data, not disposable schema.
    pass
