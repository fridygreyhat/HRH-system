"""National ID (NIDA) or Voter ID on the staff record

Each staff member has one identity document, entered at registration. A number belongs to one person only.

Revision ID: c4e7a9d21f86
Revises: b8d3f1a52e07
"""
import sqlalchemy as sa
from alembic import op

revision = "c4e7a9d21f86"
down_revision = "b8d3f1a52e07"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("staff", sa.Column("id_type", sa.String(10)))
    op.add_column("staff", sa.Column("id_number", sa.String(30)))
    op.create_check_constraint(op.f("ck_staff_id_type"), "staff", "id_type IS NULL OR id_type IN ('NIDA', 'VOTER')")
    op.create_check_constraint(op.f("ck_staff_id_pair"), "staff", "(id_type IS NULL) = (id_number IS NULL)")
    op.create_index("uq_staff_id_number", "staff", ["id_type", "id_number"], unique=True,
                    postgresql_where=sa.text("id_number IS NOT NULL"))


def downgrade():
    op.drop_index("uq_staff_id_number", table_name="staff")
    op.drop_constraint(op.f("ck_staff_id_pair"), "staff", type_="check")
    op.drop_constraint(op.f("ck_staff_id_type"), "staff", type_="check")
    op.drop_column("staff", "id_number")
    op.drop_column("staff", "id_type")
