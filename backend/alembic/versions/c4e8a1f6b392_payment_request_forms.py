"""Central Finance records a PRF against the Services report it downloaded

Revision ID: c4e8a1f6b392
Revises: b7d2c4e9f105
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "c4e8a1f6b392"
down_revision = "b7d2c4e9f105"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "services_report_downloads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("region_id", sa.Integer(), sa.ForeignKey("regions.id")),
        sa.Column("format", sa.String(4), nullable=False),
        sa.Column("claim_ids", JSONB(), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("amounts", JSONB(), nullable=False),
        sa.Column("downloaded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "payment_request_forms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("prf_number", sa.String(50), nullable=False, unique=True),
        sa.Column("prf_date", sa.Date(), nullable=False),
        sa.Column("download_id", sa.Integer(), sa.ForeignKey("services_report_downloads.id"), nullable=False, unique=True),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("region_id", sa.Integer(), sa.ForeignKey("regions.id")),
        sa.Column("amounts", JSONB(), nullable=False),
        sa.Column("claim_count", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("recorded_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(op.f("ix_payment_request_forms_month"), "payment_request_forms", ["month"])
    op.create_table(
        "payment_request_form_claims",
        sa.Column("claim_id", sa.Integer(), sa.ForeignKey("payment_claims.id"), primary_key=True),
        sa.Column("prf_id", sa.Integer(), sa.ForeignKey("payment_request_forms.id"), nullable=False),
    )
    op.create_index(op.f("ix_payment_request_form_claims_prf_id"), "payment_request_form_claims", ["prf_id"])


def downgrade():
    op.drop_index(op.f("ix_payment_request_form_claims_prf_id"), table_name="payment_request_form_claims")
    op.drop_table("payment_request_form_claims")
    op.drop_index(op.f("ix_payment_request_forms_month"), table_name="payment_request_forms")
    op.drop_table("payment_request_forms")
    op.drop_table("services_report_downloads")
