"""Apply the confirmed weekday and weekend-clinic hour policy.

Revision ID: 6c27bd81a053
Revises: 42bc8f61e09a
"""
from alembic import op

revision = "6c27bd81a053"
down_revision = "42bc8f61e09a"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        INSERT INTO system_settings (key, value, updated_at) VALUES
          ('max_daily_hours', '9.0'::jsonb, now()),
          ('max_weekly_hours', '45.0'::jsonb, now()),
          ('saturday_min_hours', '4.0'::jsonb, now()),
          ('saturday_max_hours', '6.0'::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
    """)


def downgrade():
    op.execute("DELETE FROM system_settings WHERE key IN ('saturday_min_hours', 'saturday_max_hours')")
    op.execute("UPDATE system_settings SET value = '8.5'::jsonb, updated_at = now() WHERE key = 'max_daily_hours'")
