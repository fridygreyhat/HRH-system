"""Version new work logs and claims without changing existing financial records."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "81e73c4a9210"
down_revision = "6c27bd81a053"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        INSERT INTO roles (name, description)
        VALUES ('REGIONAL_FINANCE', 'Regional Finance: validates RPM-authorized amounts and routes services to FHI360 and payroll to CSO')
        ON CONFLICT (name) DO NOTHING
    """)
    for table in ("work_logs", "payment_claims"):
        op.add_column(table, sa.Column("workflow_version", sa.Integer(), nullable=False, server_default="1"))
        op.add_column(table, sa.Column("work_type", sa.String(20), nullable=False, server_default="LEGACY"))
    op.add_column("work_logs", sa.Column("finance_snapshot", postgresql.JSONB()))
    op.add_column("work_logs", sa.Column("routed_channel", sa.String(20)))
    op.add_column("work_log_entries", sa.Column("activity_snapshot", postgresql.JSONB()))
    op.drop_constraint("uq_work_logs_staff_id", "work_logs", type_="unique")
    op.create_unique_constraint("uq_work_logs_staff_id", "work_logs", ["staff_id", "period_id", "work_type"])
    op.create_table(
        "activity_rates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(80), nullable=False, unique=True),
        sa.Column("source_key", sa.String(80)),
        sa.Column("label_en", sa.String(255), nullable=False),
        sa.Column("label_sw", sa.String(255), nullable=False),
        sa.Column("cadre_id", sa.Integer(), sa.ForeignKey("cadres.id"), nullable=False, index=True),
        sa.Column("region_id", sa.Integer(), sa.ForeignKey("regions.id"), nullable=False, index=True),
        sa.Column("item_type", sa.String(20), nullable=False),
        sa.Column("form_mode", sa.String(20), nullable=False),
        sa.Column("field_definitions", postgresql.JSONB(), nullable=False),
        sa.Column("hours_input", sa.Boolean(), nullable=False),
        sa.Column("rate_value", sa.Numeric(15, 2), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False),
        sa.Column("unit_type", sa.String(20), nullable=False),
        sa.Column("billable_field", sa.String(80)),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("effective_start_date", sa.Date(), nullable=False),
        sa.Column("supersedes_id", sa.Integer(), sa.ForeignKey("activity_rates.id")),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("item_type IN ('SERVICES', 'PAYROLL')", name=op.f("ck_activity_rates_item_type")),
        sa.CheckConstraint("form_mode IN ('CASCADE', 'SINGLE')", name=op.f("ck_activity_rates_form_mode")),
        sa.CheckConstraint("rate_value >= 0", name=op.f("ck_activity_rates_rate")),
        sa.CheckConstraint("unit_type IN ('PER_UNIT', 'PER_HOUR', 'PER_DAY')", name=op.f("ck_activity_rates_unit_type")),
    )


def downgrade():
    # Refuse a lossy downgrade if both v2 log types exist in a period.
    op.drop_constraint("uq_work_logs_staff_id", "work_logs", type_="unique")
    op.create_unique_constraint("uq_work_logs_staff_id", "work_logs", ["staff_id", "period_id"])
    op.drop_table("activity_rates")
    op.drop_column("work_log_entries", "activity_snapshot")
    op.drop_column("work_logs", "finance_snapshot")
    op.drop_column("work_logs", "routed_channel")
    for table in ("payment_claims", "work_logs"):
        op.drop_column(table, "work_type")
        op.drop_column(table, "workflow_version")
