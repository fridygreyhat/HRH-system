"""Regional pay-period schedules and removal of provider SMS confirmation."""
from alembic import op
import sqlalchemy as sa

revision = "c713f80be249"
down_revision = "b26d143a80e7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("pay_periods", sa.Column("region_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_pay_periods_region_id_regions", "pay_periods", "regions", ["region_id"], ["id"])
    op.create_index("ix_pay_periods_region_id", "pay_periods", ["region_id"])
    op.drop_constraint("uq_pay_periods_start_date", "pay_periods", type_="unique")
    op.create_unique_constraint("uq_pay_periods_dates_region", "pay_periods", ["start_date", "end_date", "region_id"])
    op.create_index("uq_pay_periods_global_dates", "pay_periods", ["start_date", "end_date"],
                    unique=True, postgresql_where=sa.text("region_id IS NULL"))
    _remove_provider_confirmation()


def _remove_provider_confirmation():
    op.execute(sa.text(
        "INSERT INTO system_settings (key,value,updated_at) VALUES ('provider_otp_required','false'::jsonb,now()) "
        "ON CONFLICT (key) DO UPDATE SET value='false'::jsonb,updated_at=now()"
    ))
    # Do not strand already verified logs or falsely record a provider confirmation.
    op.execute(sa.text(
        "INSERT INTO work_log_audit (work_log_id,version,action,old_status,new_status,comment,timestamp,details) "
        "SELECT id,version,'provider_sms_removed',status,'PENDING_TECHNICAL_REVIEW',"
        "'Provider SMS confirmation removed; CTC-verified log forwarded to Technical Review',now(),"
        "'{\"provider_confirmation\":\"not required\"}'::jsonb "
        "FROM work_logs WHERE status='PENDING_PROVIDER_OTP_CONFIRMATION'"
    ))
    op.execute("UPDATE work_logs SET status='PENDING_TECHNICAL_REVIEW',confirmed_version=version,updated_at=now() "
               "WHERE status='PENDING_PROVIDER_OTP_CONFIRMATION'")
    op.execute("UPDATE sms_outbox SET status='SUPPRESSED',last_error='Provider SMS confirmation removed' "
               "WHERE event_name='WORKLOG_OTP' AND status IN ('PENDING','FAILED')")


def downgrade():
    # Downgrade only when regional schedules have been removed explicitly.
    if op.get_bind().execute(sa.text("SELECT 1 FROM pay_periods WHERE region_id IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("Regional pay periods exist; do not discard their ownership")
    op.drop_index("uq_pay_periods_global_dates", table_name="pay_periods")
    op.drop_constraint("uq_pay_periods_dates_region", "pay_periods", type_="unique")
    op.create_unique_constraint("uq_pay_periods_start_date", "pay_periods", ["start_date", "end_date"])
    op.drop_index("ix_pay_periods_region_id", table_name="pay_periods")
    op.drop_constraint("fk_pay_periods_region_id_regions", "pay_periods", type_="foreignkey")
    op.drop_column("pay_periods", "region_id")
