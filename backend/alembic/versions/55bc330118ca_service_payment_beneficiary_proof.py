"""Store the approved beneficiary schedule covered by Services payment proof."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "55bc330118ca"
down_revision = "29c704e26523"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("payment_proofs", sa.Column("beneficiary_snapshot", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("payment_proofs", "beneficiary_snapshot")
