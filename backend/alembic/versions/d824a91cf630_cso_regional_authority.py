"""Explicit CSO regional payment authority; financial history is not inferred or rewritten."""
from alembic import op
import sqlalchemy as sa

revision = "d824a91cf630"
down_revision = "c713f80be249"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "cso_region_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("region_id", sa.Integer(), sa.ForeignKey("regions.id"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "region_id"),
    )
    op.create_index("ix_cso_region_assignments_organization_id", "cso_region_assignments", ["organization_id"])
    op.create_index("ix_cso_region_assignments_region_id", "cso_region_assignments", ["region_id"])
    # Existing staff assignments or budgets do not prove an organization's payment authority.
    # Administrators must explicitly configure the approved regional mappings.


def downgrade():
    if op.get_bind().execute(sa.text("SELECT 1 FROM cso_region_assignments LIMIT 1")).first():
        raise RuntimeError("CSO regional authority is configured; do not discard governance records")
    op.drop_table("cso_region_assignments")
