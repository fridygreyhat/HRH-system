"""Keep archived period history while allowing a fresh active schedule."""
from alembic import op
import sqlalchemy as sa

revision = "66cd441229db"
down_revision = "55bc330118ca"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("uq_pay_periods_dates_region", "pay_periods", type_="unique")
    op.drop_index("uq_pay_periods_global_dates", table_name="pay_periods")
    op.drop_constraint(op.f("ck_pay_periods_status"), "pay_periods", type_="check")
    op.create_check_constraint("status", "pay_periods", "status IN ('OPEN', 'CLOSED', 'ARCHIVED')")
    op.create_index("uq_pay_periods_dates_region", "pay_periods",
                    ["start_date", "end_date", "region_id"], unique=True,
                    postgresql_where=sa.text("region_id IS NOT NULL AND status <> 'ARCHIVED'"))
    op.create_index("uq_pay_periods_global_dates", "pay_periods",
                    ["start_date", "end_date"], unique=True,
                    postgresql_where=sa.text("region_id IS NULL AND status <> 'ARCHIVED'"))


def downgrade():
    # Never erase or reactivate history implicitly during a downgrade.
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM pay_periods WHERE status = 'ARCHIVED' LIMIT 1")).first():
        raise RuntimeError("Archived periods exist; reverting would erase the archive policy")
    op.drop_index("uq_pay_periods_dates_region", table_name="pay_periods")
    op.drop_index("uq_pay_periods_global_dates", table_name="pay_periods")
    op.drop_constraint(op.f("ck_pay_periods_status"), "pay_periods", type_="check")
    op.create_check_constraint("status", "pay_periods", "status IN ('OPEN', 'CLOSED')")
    op.create_unique_constraint("uq_pay_periods_dates_region", "pay_periods", ["start_date", "end_date", "region_id"])
    op.create_index("uq_pay_periods_global_dates", "pay_periods", ["start_date", "end_date"],
                    unique=True, postgresql_where=sa.text("region_id IS NULL"))
