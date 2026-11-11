"""Hide the four Data Clerk questions the current form replaced

The combined HVL/EID request and result counts became separate HVL and EID questions, the
CTC/HTS dataset upload became the "Backups and reporting" group, and the secondary-facility
Yes/No became its own "Data entry at a secondary facility" form with a location. Hidden, not
deleted: any value already recorded keeps its label and still prints.

Revision ID: f4b1c8e2d937
Revises: e2c7a9d4b618
"""
import sqlalchemy as sa
from alembic import op

revision = "f4b1c8e2d937"
down_revision = "e2c7a9d4b618"
branch_labels = None
depends_on = None

# Listed here rather than imported, so this step means the same thing however the code changes later.
RETIRED = ("ctc_hts_dataset_uploaded", "ctc_hvl_eid_requests", "ctc_hvl_eid_results_received", "ctc_secondary_facility")


def _set(active: bool):
    op.get_bind().execute(
        sa.text(
            "UPDATE cadre_form_fields SET is_active = :active "
            "WHERE key IN :keys AND cadre_id IN (SELECT id FROM cadres WHERE code = 'DATA_CLERK')"
        ).bindparams(sa.bindparam("keys", expanding=True)),
        {"active": active, "keys": list(RETIRED)},
    )


def upgrade():
    _set(False)


def downgrade():
    _set(True)
