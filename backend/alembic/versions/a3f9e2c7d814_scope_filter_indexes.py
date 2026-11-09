"""indexes behind the scope filters every list uses

Revision ID: a3f9e2c7d814
Revises: f1c4d6e8a2b3
"""
from alembic import op

revision = "a3f9e2c7d814"
down_revision = "f1c4d6e8a2b3"
branch_labels = None
depends_on = None

INDEXES = (("staff_assignments", "region_id"), ("staff_assignments", "facility_id"), ("staff_assignments", "organization_id"),
           ("work_logs", "assignment_id"), ("payment_claims", "period_id"))


def upgrade():
    for table, column in INDEXES:
        op.create_index(op.f(f"ix_{table}_{column}"), table, [column])


def downgrade():
    for table, column in INDEXES:
        op.drop_index(op.f(f"ix_{table}_{column}"), table_name=table)
