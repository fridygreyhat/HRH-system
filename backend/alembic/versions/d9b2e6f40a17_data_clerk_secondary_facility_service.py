"""Data Clerk Services: "Secondary facility", with the number of records entered there

A Data Clerk is paid per day for Services at a secondary facility: the facility's name is typed on the day, and this
question counts the records entered there. Added after the existing Data Clerk questions.

Revision ID: d9b2e6f40a17
Revises: c4e7a9d21f86
"""
import sqlalchemy as sa
from alembic import op

revision = "d9b2e6f40a17"
down_revision = "c4e7a9d21f86"
branch_labels = None
depends_on = None

KEY = "dc_secondary_records_entered"


def upgrade():
    op.get_bind().execute(sa.text(
        "INSERT INTO cadre_form_fields (cadre_id, key, label_en, label_sw, field_type, sort_order, is_active) "
        "SELECT c.id, :key, 'Records entered at the secondary facility', 'Kumbukumbu zilizoingizwa katika kituo kingine', "
        "'INTEGER', COALESCE((SELECT MAX(f.sort_order) + 1 FROM cadre_form_fields f WHERE f.cadre_id = c.id), 0), true "
        "FROM cadres c WHERE c.code = 'DATA_CLERK' "
        "AND NOT EXISTS (SELECT 1 FROM cadre_form_fields f WHERE f.cadre_id = c.id AND f.key = :key)"), {"key": KEY})


def downgrade():
    # Kept if any day already recorded it, so those values keep their label.
    op.get_bind().execute(sa.text(
        "DELETE FROM cadre_form_fields WHERE key = :key AND cadre_id IN (SELECT id FROM cadres WHERE code = 'DATA_CLERK') "
        "AND NOT EXISTS (SELECT 1 FROM work_log_measures m WHERE m.field_key = :key)"), {"key": KEY})
