"""Salary payments recorded by CSOs, and Central Finance's monthly reconciliation sign-offs

Revision ID: a6b9e2f17c58
Revises: f2c6d8a41e93
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "a6b9e2f17c58"
down_revision = "f2c6d8a41e93"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "payroll_payments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("region_id", sa.Integer, sa.ForeignKey("regions.id", name="fk_payroll_payments_region_id_regions"), nullable=False),
        sa.Column("organization_id", sa.Integer, sa.ForeignKey("organizations.id", name="fk_payroll_payments_organization_id_organizations"), nullable=False),
        sa.Column("staff_id", sa.Integer, sa.ForeignKey("staff.id", name="fk_payroll_payments_staff_id_staff"), nullable=False),
        sa.Column("report_id", sa.Integer, sa.ForeignKey("finance_monthly_reports.id", name="fk_payroll_payments_report_id_finance_monthly_reports"), nullable=False),
        sa.Column("expected_amount", sa.Numeric(15, 2)),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("payment_date", sa.Date, nullable=False),
        sa.Column("payment_reference", sa.String(200), nullable=False),
        sa.Column("payment_method", sa.String(20), nullable=False),
        sa.Column("pay_components", JSONB),
        sa.Column("proof_key", sa.String(255)),
        sa.Column("proof_filename", sa.String(255)),
        sa.Column("proof_content_type", sa.String(100)),
        sa.Column("proof_size_bytes", sa.Integer),
        sa.Column("proof_sha256", sa.String(64)),
        sa.Column("recorded_by", sa.Integer, sa.ForeignKey("users.id", name="fk_payroll_payments_recorded_by_users"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("voided_at", sa.DateTime(timezone=True)),
        sa.Column("voided_by", sa.Integer, sa.ForeignKey("users.id", name="fk_payroll_payments_voided_by_users")),
        sa.Column("void_reason", sa.Text),
        sa.CheckConstraint("status IN ('PAID', 'FAILED')", name="ck_payroll_payments_status"),
        sa.CheckConstraint("amount >= 0 AND (status <> 'PAID' OR amount > 0)", name="ck_payroll_payments_amount"),
        sa.CheckConstraint("payment_method IN ('BANK', 'MOBILE_WALLET')", name="ck_payroll_payments_method"),
    )
    op.create_index("ix_payroll_payments_month_region", "payroll_payments", ["month", "region_id"])
    op.create_index("ix_payroll_payments_staff_month", "payroll_payments", ["staff_id", "month"])
    op.create_index("ix_payroll_payments_organization_id", "payroll_payments", ["organization_id"])
    op.create_table(
        "finance_reconciliations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("region_id", sa.Integer, sa.ForeignKey("regions.id", name="fk_finance_reconciliations_region_id_regions")),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("totals", JSONB, nullable=False),
        sa.Column("issue_count", sa.Integer, nullable=False),
        sa.Column("note", sa.Text),
        sa.Column("signed_by", sa.Integer, sa.ForeignKey("users.id", name="fk_finance_reconciliations_signed_by_users"), nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_finance_reconciliations_month", "finance_reconciliations", ["month", "region_id", "id"])
    # Payments and sign-offs are the audit trail: they are never deleted (a payment is voided instead).
    op.execute("""
        CREATE OR REPLACE FUNCTION reconciliation_rows_append_only() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME;
            END IF;
            IF TG_TABLE_NAME = 'finance_reconciliations' THEN
                RAISE EXCEPTION 'finance_reconciliations rows are never changed';
            END IF;
            -- A payment only gains its void details; what was paid stays as recorded.
            IF (NEW.month, NEW.region_id, NEW.organization_id, NEW.staff_id, NEW.report_id, NEW.expected_amount, NEW.amount,
                NEW.currency, NEW.status, NEW.payment_date, NEW.payment_reference, NEW.payment_method, NEW.recorded_by,
                NEW.created_at, NEW.proof_key, NEW.proof_sha256)
               IS DISTINCT FROM
               (OLD.month, OLD.region_id, OLD.organization_id, OLD.staff_id, OLD.report_id, OLD.expected_amount, OLD.amount,
                OLD.currency, OLD.status, OLD.payment_date, OLD.payment_reference, OLD.payment_method, OLD.recorded_by,
                OLD.created_at, OLD.proof_key, OLD.proof_sha256)
               OR OLD.voided_at IS NOT NULL THEN
                RAISE EXCEPTION 'A recorded salary payment is not changed; void it with a reason and record it again';
            END IF;
            RETURN NEW;
        END $$ LANGUAGE plpgsql;
    """)
    for table in ("payroll_payments", "finance_reconciliations"):
        op.execute(f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} "
                   f"FOR EACH ROW EXECUTE FUNCTION reconciliation_rows_append_only()")


def downgrade():
    for table in ("payroll_payments", "finance_reconciliations"):
        op.execute(f"DROP TRIGGER IF EXISTS {table}_append_only ON {table}")
    op.execute("DROP FUNCTION IF EXISTS reconciliation_rows_append_only()")
    op.drop_table("finance_reconciliations")
    op.drop_table("payroll_payments")
