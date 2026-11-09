"""one stored proof document can cover many claims (a PRF's bank schedule)

Revision ID: d6b3f9a2c517
Revises: c4e8a1f6b392
"""
from alembic import op

revision = "d6b3f9a2c517"
down_revision = "c4e8a1f6b392"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(op.f("uq_payment_proofs_storage_key"), "payment_proofs", type_="unique")
    op.create_index(op.f("ix_payment_proofs_storage_key"), "payment_proofs", ["storage_key"])


def downgrade():
    op.drop_index(op.f("ix_payment_proofs_storage_key"), table_name="payment_proofs")
    op.create_unique_constraint(op.f("uq_payment_proofs_storage_key"), "payment_proofs", ["storage_key"])
