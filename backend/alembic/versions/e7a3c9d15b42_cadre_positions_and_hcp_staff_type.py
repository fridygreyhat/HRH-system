"""Cadre positions from the HRH cadre list; an HCP is Government or Project facility staff

Each cadre (CHW, Data Clerk, HCP) gets the positions on the HRH cadre list as its occupation options. Positions
already recorded on staff records or timesheets stay as they are. HCP staff now say whether they are Government
facility staff or Project facility staff.

Revision ID: e7a3c9d15b42
Revises: d5f2b8c93a61
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "e7a3c9d15b42"
down_revision = "d5f2b8c93a61"
branch_labels = None
depends_on = None

POSITIONS = {
    "CHW": ["CHW (HIV + TB)", "CHW/CBHSCO Focal Person", "Other"],
    "DATA_CLERK": ["Facility Data Clerk", "District Data Officer", "Data Intern", "Data Clerk (HVL Hub)",
                   "PnP Facility HRH", "Other"],
    "HCP": ["OPD Tester", "Clinical Officer", "Enrolled Nurse", "Nurse", "Assistant Nursing Officer",
            "Medical/Health Attendant", "Laboratory Technician", "Laboratory Scientist", "PnP Facility HRH", "Other"],
}


def upgrade():
    op.add_column("staff", sa.Column("facility_staff_type", sa.String(20)))
    op.create_check_constraint(op.f("ck_staff_facility_staff_type"), "staff",
                               "facility_staff_type IS NULL OR facility_staff_type IN ('GOVERNMENT', 'PROJECT')")
    for code, options in POSITIONS.items():
        op.execute(sa.text("UPDATE cadres SET occupation_options = CAST(:options AS jsonb) WHERE code = :code")
                   .bindparams(options=json.dumps(options), code=code))


def downgrade():
    op.drop_constraint(op.f("ck_staff_facility_staff_type"), "staff", type_="check")
    op.drop_column("staff", "facility_staff_type")
