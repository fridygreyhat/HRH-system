"""Monthly Services budgets and exactly-once deductions at Regional Finance routing."""
from alembic import op
import sqlalchemy as sa

revision = "78f40c16532d"
down_revision = "77e3fb05421c"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("monthly_service_budgets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("region_id", sa.Integer(), sa.ForeignKey("regions.id"), nullable=False),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("allocated_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("deducted_amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("document_name", sa.String(255), nullable=False),
        sa.Column("document_type", sa.String(100), nullable=False),
        sa.Column("document_data", sa.LargeBinary(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("region_id", "month", "currency"),
        sa.CheckConstraint("allocated_amount >= 0 AND deducted_amount >= 0 AND deducted_amount <= allocated_amount",
                           name="monthly_services_balance"))
    op.create_index("ix_monthly_service_budgets_region_id", "monthly_service_budgets", ["region_id"])
    op.create_table("monthly_service_budget_charges",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("budget_id", sa.Integer(), sa.ForeignKey("monthly_service_budgets.id"), nullable=False),
        sa.Column("claim_id", sa.Integer(), sa.ForeignKey("payment_claims.id"), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("budget_id", "claim_id"),
        sa.CheckConstraint("amount > 0", name="monthly_services_charge_positive"))
    op.create_index("ix_monthly_service_budget_charges_budget_id", "monthly_service_budget_charges", ["budget_id"])
    op.create_index("ix_monthly_service_budget_charges_claim_id", "monthly_service_budget_charges", ["claim_id"])


def downgrade():
    op.drop_table("monthly_service_budget_charges")
    op.drop_table("monthly_service_budgets")
