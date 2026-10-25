"""The CHW daily sheet and initial service, kept separate from legacy templates."""
from copy import deepcopy


CHW_GROUPS = [
    {"key": "hiv", "label_en": "HIV testing and linkage", "label_sw": "VVU na uunganishaji wa huduma",
     "color": "teal", "fields": ["chw_hiv_counselled", "chw_hiv_eligible", "chw_hiv_positive",
                                "chw_hiv_linked_art", "chw_art_escort_referrals", "chw_lcm_enrollments"]},
    {"key": "tb", "label_en": "TB screening", "label_sw": "Uchunguzi wa TB",
     "color": "amber", "fields": ["chw_tb_screened", "chw_tb_symptomatic"]},
    {"key": "appointments", "label_en": "Appointment follow-up", "label_sw": "Ufuatiliaji wa miadi",
     "color": "blue", "fields": ["chw_appointment_calls", "chw_appointments_attended", "chw_missap_followups"]},
    {"key": "laboratory", "label_en": "HVL / DBS follow-up", "label_sw": "Ufuatiliaji wa HVL / DBS",
     "color": "violet", "fields": ["chw_hvl_followups", "chw_dbs_followups"]},
    {"key": "self_testing", "label_en": "HIV self-testing", "label_sw": "Kujipima VVU",
     "color": "rose", "fields": ["chw_self_tests_distributed"]},
]

CHW_SERVICE_FIELDS = [
    ("chw_special_clinic_expected", "Expected Client Attendees", "Wateja waliotarajiwa kuhudhuria"),
    ("chw_special_clinic_served", "Clients attended and served", "Wateja waliohudhuria na kuhudumiwa"),
]


def chw_builtins(fields, cadre_id):
    daily_keys = [key for group in CHW_GROUPS for key in group["fields"]]
    definitions = [
        {"key": "chw_daily_timesheet", "label_en": "Daily CHW timesheet", "label_sw": "Daftari la kila siku la CHW",
         "item_type": "PAYROLL", "fields": daily_keys, "groups": deepcopy(CHW_GROUPS),
         "unit_type": "PER_HOUR", "billable_field": None},
        {"key": "chw_weekend_clinic", "label_en": "Special and Weekend Clinics", "label_sw": "Kliniki maalum na za mwisho wa wiki",
         "item_type": "SERVICES", "fields": [item[0] for item in CHW_SERVICE_FIELDS],
         "unit_type": "PER_UNIT", "billable_field": "chw_special_clinic_served",
         "cascade_pairs": [("chw_special_clinic_served", "chw_special_clinic_expected", "Clients served exceed expected attendees")]},
    ]
    for item in definitions:
        item.update(
            cadre_id=cadre_id, form_mode="CASCADE", required_fields=list(item["fields"]),
            field_definitions=[fields[key] for key in item["fields"]],
            hours_input=True, rate_value=None, currency="TZS", requires_location=False,
        )
        item.setdefault("cascade_pairs", [])
    return definitions
