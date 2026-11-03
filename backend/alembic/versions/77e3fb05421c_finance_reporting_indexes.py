"""Index monthly work and routed Services reports without changing historical data."""
from alembic import op

revision = "77e3fb05421c"
down_revision = "76d2eaf3410b"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_payment_claims_services_reporting", "payment_claims", ["work_type", "route_code", "status"])
    op.create_index("ix_payment_claims_assignment_id", "payment_claims", ["assignment_id"])
    op.create_index("ix_work_log_entries_month_reporting", "work_log_entries", ["entry_date", "work_log_id"])


def downgrade():
    op.drop_index("ix_work_log_entries_month_reporting", table_name="work_log_entries")
    op.drop_index("ix_payment_claims_assignment_id", table_name="payment_claims")
    op.drop_index("ix_payment_claims_services_reporting", table_name="payment_claims")
