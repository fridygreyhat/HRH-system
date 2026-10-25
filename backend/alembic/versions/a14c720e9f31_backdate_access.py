"""Date-specific technical permission for late timesheets."""
from alembic import op
import sqlalchemy as sa

revision = "a14c720e9f31"
down_revision = "92a64d7e301b"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "backdate_access",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=False),
        sa.Column("assignment_id", sa.Integer(), sa.ForeignKey("staff_assignments.id"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("granted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.String(1000), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_backdate_access_staff_id", "backdate_access", ["staff_id"])
    op.execute("INSERT INTO system_settings (key, value, updated_at) VALUES ('backdate_grace_hours', '72'::jsonb, now()) "
               "ON CONFLICT (key) DO UPDATE SET value = '72'::jsonb, updated_at = now()")


def downgrade():
    op.drop_index("ix_backdate_access_staff_id", table_name="backdate_access")
    op.drop_table("backdate_access")
