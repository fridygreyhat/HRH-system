"""CHW daily reporting and Services, kept separate from legacy templates."""
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

CHW_TB_CONTACT_FIELDS = [
    ("chw_tb_contacts_listed", "TB Case Contacts Listed (Household and close contacts of the TB client)",
     "Watu wa kaya na watu wa karibu wa mteja wa TB walioorodheshwa"),
    ("chw_tb_contacts_screened", "TB Contacts Reached and Screened for TB",
     "Watu waliokuwa karibu na mteja wa TB waliofikiwa na kuchunguzwa TB"),
    ("chw_tb_contacts_presumptive", "Presumptive TB Contacts Identified",
     "Watu waliokuwa karibu na mteja wa TB waliotambuliwa kuwa na dalili za TB"),
    ("chw_tb_contact_samples_transported", "Samples collected and transported for TB confirmation/Investigation",
     "Sampuli zilizokusanywa na kusafirishwa kwa uchunguzi au uthibitisho wa TB"),
    ("chw_tb_contacts_started_referred", "TB Cases Diagnosed and Started/Referred for TB Treatment",
     "Wagonjwa waliothibitishwa kuwa na TB na kuanzishiwa au kupewa rufaa ya matibabu"),
]


def chw_builtins(fields, cadre_id):
    fields = deepcopy(fields)
    # These are first-class catalog definitions, including on existing installs
    # whose seeded cadre_form_fields predate this service. No startup DB writes.
    for sort_order, (key, en, sw) in enumerate(CHW_TB_CONTACT_FIELDS, start=210):
        fields.setdefault(key, {
            "key": key, "label_en": en, "label_sw": sw, "field_type": "INTEGER",
            "sort_order": sort_order, "is_active": True,
        })
    daily_keys = [key for group in CHW_GROUPS for key in group["fields"]]
    definitions = [
        {"key": "chw_daily_timesheet", "label_en": "Daily CHW timesheet", "label_sw": "Daftari la kila siku la CHW",
         "item_type": "PAYROLL", "fields": daily_keys, "groups": deepcopy(CHW_GROUPS),
         "unit_type": "PER_HOUR", "billable_field": None},
        {"key": "chw_weekend_clinic", "label_en": "Special and Weekend Clinics", "label_sw": "Kliniki maalum na za mwisho wa wiki",
         "item_type": "SERVICES", "fields": [item[0] for item in CHW_SERVICE_FIELDS],
         "unit_type": "PER_UNIT", "billable_field": "chw_special_clinic_served",
         "cascade_pairs": [("chw_special_clinic_served", "chw_special_clinic_expected", "Clients served exceed expected attendees")]},
        {"key": "chw_tb_contact_tracing", "label_en": "TB Contact tracing", "label_sw": "Ufuatiliaji wa watu wa karibu wa mgonjwa wa TB",
         "item_type": "SERVICES", "fields": [item[0] for item in CHW_TB_CONTACT_FIELDS],
         "unit_type": "PER_DAY", "billable_field": None},
    ]
    for item in definitions:
        item.update(
            cadre_id=cadre_id, form_mode="CASCADE", required_fields=list(item["fields"]),
            field_definitions=[fields[key] for key in item["fields"]],
            hours_input=True, rate_value=None, currency="TZS", requires_location=False,
        )
        item.setdefault("cascade_pairs", [])
    return definitions
