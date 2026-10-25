"""Add CHW Special and Weekend Clinics indicators without changing past entries."""
from alembic import op
import sqlalchemy as sa

revision = "b26d143a80e7"
down_revision = "a14c720e9f31"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    for index, (key, en, sw) in enumerate([
        ("chw_special_clinic_expected", "Expected Client Attendees", "Wateja waliotarajiwa kuhudhuria"),
        ("chw_special_clinic_served", "Clients attended and served", "Wateja waliohudhuria na kuhudumiwa"),
    ], start=200):
        connection.execute(sa.text(
            "INSERT INTO cadre_form_fields (cadre_id, key, label_en, label_sw, field_type, sort_order, is_active) "
            "SELECT id, :key, :en, :sw, 'INTEGER', :sort_order, true FROM cadres WHERE code = 'CHW' "
            "ON CONFLICT (cadre_id, key) DO NOTHING"
        ), {"key": key, "en": en, "sw": sw, "sort_order": index})


def downgrade():
    # Indicator definitions can be referenced by immutable entries; retain them.
    pass
