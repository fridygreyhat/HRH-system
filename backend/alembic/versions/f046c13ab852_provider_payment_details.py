"""Separate bank payroll details from mobile service-payment details."""
from alembic import op
import sqlalchemy as sa

revision = "f046c13ab852"
down_revision = "e935b02da741"
branch_labels = None
depends_on = None


def upgrade():
    for name, length in (("bank_name", 100), ("bank_account_number", 34),
                         ("bank_branch", 100), ("mobile_money_number", 20)):
        op.add_column("staff", sa.Column(name, sa.String(length), nullable=True))
    op.add_column("staff", sa.Column("payment_details_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    if op.get_bind().execute(sa.text(
        "SELECT 1 FROM staff WHERE bank_name IS NOT NULL OR bank_account_number IS NOT NULL "
        "OR bank_branch IS NOT NULL OR mobile_money_number IS NOT NULL OR payment_details_updated_at IS NOT NULL LIMIT 1"
    )).first():
        raise RuntimeError("Provider payment details are configured; do not discard them")
    for name in ("payment_details_updated_at", "mobile_money_number", "bank_branch", "bank_account_number", "bank_name"):
        op.drop_column("staff", name)
