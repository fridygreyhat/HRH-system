"""Preserve minute-level elapsed time without rounding each day to hundredths."""
from alembic import op
import sqlalchemy as sa

revision = "76d2eaf3410b"
down_revision = "75c1d9e230fa"
branch_labels = None
depends_on = None


def upgrade():
    # Widen storage only: do not rewrite approved or paid historical work.
    op.alter_column("work_log_entries", "hours_worked", existing_type=sa.Numeric(5, 2),
                    type_=sa.Numeric(10, 6), existing_nullable=False)


def downgrade():
    op.alter_column("work_log_entries", "hours_worked", existing_type=sa.Numeric(10, 6),
                    type_=sa.Numeric(5, 2), existing_nullable=False)
