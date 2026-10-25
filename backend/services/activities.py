"""Activity-specific daily measures transcribed from the supplied HRH forms."""
from .chw_forms import CHW_SERVICE_FIELDS

# Each entry is one daily activity. Its measures are shown together in the
# provider form, reviewer summary, and print view rather than asking staff to
# complete every indicator for every activity.
ACTIVITIES = {
    "CHW": [
        {"key": "hiv_testing", "label_en": "HIV testing and linkage", "label_sw": "Upimaji wa VVU na kuwaunganisha na huduma", "fields": [
            "chw_hiv_counselled", "chw_hiv_eligible", "clients_screened_hiv_tb",
            "clients_linked_hiv_tb_testing", "chw_hiv_positive", "chw_hiv_linked_art",
            "chw_art_escort_referrals", "chw_lcm_enrollments",
        ]},
        {"key": "tb_screening", "label_en": "TB screening and referrals", "label_sw": "Uchunguzi wa TB na rufaa", "fields": [
            "chw_tb_screened", "chw_tb_symptomatic",
        ]},
        {"key": "appointment_followup", "label_en": "Appointment and missed-visit follow-up", "label_sw": "Ufuatiliaji wa miadi na waliokosa miadi", "fields": [
            "chw_appointment_calls", "chw_appointments_attended",
            "chw_missap_followups", "ltfu_clients_assigned", "clients_followed_up",
            "clients_returned_to_care",
        ]},
        {"key": "lab_followup", "label_en": "HVL and child DBS follow-up", "label_sw": "Ufuatiliaji wa vipimo vya HVL na DBS kwa watoto", "fields": [
            "chw_hvl_followups", "chw_dbs_followups",
        ]},
        {"key": "self_testing", "label_en": "HIV self-test distribution", "label_sw": "Usambazaji wa vipimo vya kujipima VVU", "fields": [
            "chw_self_tests_distributed",
        ]},
    ],
    "DATA_CLERK": [
        {"key": "ctc_data", "label_en": "CTC-2 and treatment-data entry", "label_sw": "Uingizaji wa takwimu za CTC-2 na matibabu", "fields": [
            "ctc_clients_registered", "ctc_transfers_in", "ctc_appointments_expected",
            "ctc_visits_updated", "pharmacy_visits_entered", "ctc_clients_tb_screened",
            "ctc_tpt_eligible", "ctc_tpt_initiated", "hei_visits_updated",
            "hts_clients_registered", "ctc_hts_dataset_uploaded",
        ]},
        {"key": "hts_data", "label_en": "HTS and contact data entry", "label_sw": "Uingizaji wa takwimu za HTS na waliotajwa", "fields": [
            "hts_clients_registered", "hts_clients_positive", "ctc_elicited_contacts",
            "ctc_hts_dataset_uploaded",
        ]},
        {"key": "lab_data", "label_en": "HVL and EID requests and results", "label_sw": "Maombi na majibu ya vipimo vya HVL na EID", "fields": [
            "ctc_hvl_eligible", "ctc_eid_eligible", "ctc_hvl_requests", "ctc_eid_requests",
            "ctc_hvl_results_received", "ctc_eid_results_received",
        ]},
        {"key": "reporting", "label_en": "Backups, reporting, and weekly lists", "label_sw": "Nakala za akiba, taarifa na orodha za wiki", "fields": [
            "ctc_full_backup", "ctc_monthly_portal_submission", "ctc_nashcop_raw_export",
            "ctc_nashcop_aggregate_export", "ctc_eligible_lists_shared",
            "ctc_hvl_eid_results_shared",
        ]},
        {"key": "secondary_facility", "label_en": "Data entry at a secondary facility", "label_sw": "Uingizaji wa takwimu katika kituo kingine", "fields": [
            "ctc_secondary_facility", "ctc_clients_registered", "ctc_transfers_in",
            "ctc_appointments_expected", "ctc_visits_updated", "pharmacy_visits_entered",
            "ctc_clients_tb_screened", "ctc_tpt_eligible", "ctc_tpt_initiated",
            "hei_visits_updated", "hts_clients_registered", "hts_clients_positive",
            "ctc_elicited_contacts", "ctc_hvl_eligible", "ctc_eid_eligible",
            "ctc_hvl_requests", "ctc_eid_requests", "ctc_hvl_results_received",
            "ctc_eid_results_received", "ctc_full_backup",
            "ctc_monthly_portal_submission", "ctc_nashcop_raw_export",
            "ctc_nashcop_aggregate_export",
        ]},
    ],
    "HCP": [
        {"key": "index_testing", "label_en": "Index testing outreach", "label_sw": "Huduma za upimaji wa watu waliotajwa", "fields": [
            "hcp_index_appointments", "clients_tested_hiv", "clients_tested_index",
            "hcp_index_positive", "clients_tested_positive_new", "hiv_positive_linked_art",
        ]},
        {"key": "sns_rnr_testing", "label_en": "SNS-RNR testing outreach", "label_sw": "Huduma za upimaji wa SNS-RNR", "fields": [
            "hcp_sns_appointments", "clients_tested_sns", "hcp_sns_positive", "hiv_positive_linked_art",
        ]},
        {"key": "tb_contact_tracing", "label_en": "TB contact tracing", "label_sw": "Ufuatiliaji wa waliokaribiana na mgonjwa wa TB", "fields": [
            "tb_contacts_traced", "hcp_tb_contacts_screened", "hcp_tb_contacts_presumptive",
            "tb_samples_collected", "hcp_tb_contacts_diagnosed_started",
        ]},
        {"key": "weekend_clinic", "label_en": "Special and weekend clinics", "label_sw": "Kliniki maalum na za mwisho wa wiki", "fields": [
            "hcp_special_clinic_expected", "weekend_clinic_attended",
        ]},
        {"key": "tb_active_case_finding", "label_en": "Community TB active case finding", "label_sw": "Uchunguzi wa TB katika jamii", "fields": [
            "hcp_tb_population_mobilized", "hcp_tb_population_screened",
            "hcp_tb_active_presumptive", "tb_samples_collected", "hcp_tb_active_diagnosed_started",
        ]},
        {"key": "inmate_tb_screening", "label_en": "Quarterly inmate TB screening", "label_sw": "Uchunguzi wa TB kwa wafungwa wa robo mwaka", "fields": [
            "hcp_inmates_reached", "hcp_inmates_screened", "hcp_inmates_symptomatic",
            "hcp_inmates_presumptive", "tb_samples_collected", "hcp_inmates_diagnosed_started",
        ]},
        {"key": "opd_screening", "label_en": "OPD HIV/TB screening", "label_sw": "Uchunguzi wa VVU/TB kwa wagonjwa wa nje", "fields": [
            "hcp_opd_attendees", "hcp_opd_screened", "clients_tested_opitc",
            "clients_tested_positive_new", "hiv_positive_linked_art",
            "hcp_opd_presumptive_tb", "tb_samples_collected", "hcp_opd_tb_diagnosed_started",
        ]},
        {"key": "ctc_art_refills", "label_en": "CTC ART initiation and refills", "label_sw": "Kuanzisha ART na kujaza dawa kliniki ya CTC", "fields": [
            "hcp_art_initiated", "hcp_art_refill_appointments_served",
            "hcp_cd4_samples_taken", "hcp_hvl_samples_taken",
        ]},
        {"key": "laboratory", "label_en": "HVL, DBS and CD4 laboratory services", "label_sw": "Huduma za maabara za HVL, DBS na CD4", "fields": [
            "hcp_lab_hvl_received", "hcp_lab_hvl_processed", "hcp_lab_hvl_disbursed",
            "hcp_lab_dbs_received", "hcp_lab_dbs_processed", "hcp_lab_dbs_disbursed",
            "hcp_lab_cd4_received", "hcp_lab_cd4_processed", "hcp_lab_cd4_disbursed",
        ]},
    ],
}

FIELD_SPECS = {
    "CHW": [
        ("chw_hiv_counselled", "Clients counselled about HIV", "Wateja waliopata ushauri kuhusu VVU"),
        ("chw_hiv_eligible", "Clients eligible for HIV testing", "Wateja waliokidhi vigezo vya upimaji wa VVU"),
        ("chw_hiv_positive", "Clients newly identified HIV positive", "Wateja wapya waliopatikana na VVU"),
        ("chw_hiv_linked_art", "Clients linked to ART care", "Wateja waliounganishwa na huduma za ART"),
        ("chw_art_escort_referrals", "ART escort referrals completed", "Rufaa za kusindikiza kwenye huduma za ART"),
        ("chw_lcm_enrollments", "Clients newly enrolled in six-month LCM", "Wateja wapya walioingizwa kwenye LCM ya miezi sita"),
        ("chw_tb_screened", "Clients screened for TB", "Wateja waliochunguzwa kuhusu TB"),
        ("chw_tb_symptomatic", "Clients with TB symptoms", "Wateja walioonyesha dalili za TB"),
        ("chw_appointment_calls", "Clients called to attend services", "Wateja waliopigiwa simu kufika huduma"),
        ("chw_appointments_attended", "Clients attending on scheduled dates", "Wateja waliohudhuria tarehe waliyopangiwa"),
        ("chw_missap_followups", "Missed appointment follow-ups (MISSAP)", "Ufuatiliaji wa waliokosa miadi (MISSAP)"),
        ("chw_hvl_followups", "Clients followed up for HVL sampling", "Wateja waliofuatiliwa kwa kipimo cha HVL"),
        ("chw_dbs_followups", "Children followed up for DBS sampling", "Watoto waliofuatiliwa kwa kipimo cha DBS"),
        *CHW_SERVICE_FIELDS,
        ("chw_self_tests_distributed", "HIV self-test kits distributed (HTS_SELF)", "Vipimo vya kujipima VVU vilivyosambazwa"),
    ],
    "DATA_CLERK": [
        ("ctc_transfers_in", "CTC clients transferred in", "Wateja waliohamishiwa kuingia CTC"),
        ("ctc_appointments_expected", "CTC appointments expected", "Miadi ya CTC iliyotarajiwa"),
        ("pharmacy_visits_entered", "Dispensing records entered in CTC-2 PMD", "Rekodi za dawa zilizoingizwa kwenye PMD"),
        ("ctc_clients_tb_screened", "CTC clients screened for TB", "Wateja wa CTC waliochunguzwa TB"),
        ("ctc_tpt_eligible", "CTC clients eligible for TPT", "Wateja wa CTC wanaostahili TPT"),
        ("ctc_tpt_initiated", "CTC clients initiated on TPT", "Wateja wa CTC walioanzishiwa TPT"),
        ("hei_visits_updated", "HEI visits entered in CTC-2", "Ziara za HEI zilizoingizwa CTC-2"),
        ("hts_clients_registered", "HTS data entered in the HTS module", "Takwimu za HTS zilizoingizwa kwenye moduli"),
        ("hts_clients_positive", "HTS clients found HIV positive", "Wateja wa HTS waliopatikana na VVU"),
        ("ctc_elicited_contacts", "Elicited contacts entered in CTC-2", "Waliotajwa walioingizwa kwenye CTC-2"),
        ("ctc_hvl_eligible", "CTC clients eligible for HVL samples", "Wateja wa CTC wanaostahili sampuli ya HVL"),
        ("ctc_eid_eligible", "HEI eligible for EID samples", "Watoto walio katika hatari wanaostahili sampuli ya EID"),
        ("ctc_hvl_eid_requests", "HVL/EID test requests entered and uploaded", "Maombi ya vipimo vya HVL/EID yaliyoingizwa na kupakiwa"),
        ("ctc_hvl_eid_results_received", "HVL/EID results received and updated", "Majibu ya HVL/EID yaliyopokelewa na kusasishwa"),
        ("ctc_hvl_requests", "HVL requests registered and uploaded to CTC-3", "Maombi ya HVL yaliyosajiliwa na kupakiwa CTC-3"),
        ("ctc_eid_requests", "EID requests registered and uploaded to CTC-3", "Maombi ya EID yaliyosajiliwa na kupakiwa CTC-3"),
        ("ctc_hvl_results_received", "HVL results received and updated in CTC-2", "Majibu ya HVL yaliyopokelewa na kusasishwa CTC-2"),
        ("ctc_eid_results_received", "EID results received and updated in HEI profile", "Majibu ya EID yaliyopokelewa na kusasishwa kwenye HEI"),
        ("ctc_full_backup", "CTC-2 full backup saved externally (Yes/No)", "Nakala kamili ya CTC-2 imehifadhiwa nje (Ndiyo/Hapana)", "BOOLEAN"),
        ("ctc_monthly_portal_submission", "Monthly Portal dataset submitted (Yes/No)", "Takwimu zimewasilishwa kwenye Monthly Portal (Ndiyo/Hapana)", "BOOLEAN"),
        ("ctc_nashcop_raw_export", "NASHCoP comprehensive raw export (Yes/No)", "Takwimu ghafi za NASHCoP zimesafirishwa (Ndiyo/Hapana)", "BOOLEAN"),
        ("ctc_nashcop_aggregate_export", "NASHCoP aggregate export (Yes/No)", "Takwimu jumla za NASHCoP zimesafirishwa (Ndiyo/Hapana)", "BOOLEAN"),
        ("ctc_eligible_lists_shared", "Weekly eligible-client lists shared with HCPs", "Orodha za wateja wanaostahili zimeshirikiwa na HCP"),
        ("ctc_hvl_eid_results_shared", "HVL/EID results shared with HCPs (Yes/No)", "Majibu ya HVL/EID yameshirikiwa na HCP (Ndiyo/Hapana)", "BOOLEAN"),
        ("ctc_secondary_facility", "Data-entry support provided at a secondary facility (Yes/No)", "Msaada wa takwimu umetolewa kituo kingine (Ndiyo/Hapana)", "BOOLEAN"),
    ],
    "HCP": [
        ("hcp_index_appointments", "Index contacts with appointments", "Watu waliotajwa wenye miadi"),
        ("hcp_index_positive", "Index contacts newly HIV positive", "Watu waliotajwa waliopatikana wapya na VVU"),
        ("hcp_sns_appointments", "SNS-RNR contacts with appointments", "Watu wa SNS-RNR wenye miadi"),
        ("hcp_sns_positive", "SNS-RNR contacts newly HIV positive", "Watu wa SNS-RNR waliopatikana wapya na VVU"),
        ("hcp_tb_contacts_screened", "TB contacts reached and screened", "Waliokaribiana na TB waliofikiwa na kuchunguzwa"),
        ("hcp_tb_contacts_presumptive", "Presumptive TB cases in contact tracing", "Waliobainika na dalili za TB kwenye ufuatiliaji"),
        ("hcp_tb_contacts_diagnosed_started", "TB contacts diagnosed and started/referred", "Waliothibitishwa na kuanza/kuelekezwa matibabu"),
        ("hcp_special_clinic_expected", "Expected special/weekend clinic attendees", "Wateja waliotarajiwa kliniki maalum/mwisho wa wiki"),
        ("hcp_tb_population_mobilized", "Population mobilized for active TB case finding", "Jamii iliyohamasishwa kwa uchunguzi wa TB"),
        ("hcp_tb_population_screened", "Population screened for TB symptoms", "Jamii iliyochunguzwa dalili za TB"),
        ("hcp_tb_active_presumptive", "Presumptive TB cases from active case finding", "Waliobainika na dalili kwenye uchunguzi wa jamii"),
        ("hcp_tb_active_diagnosed_started", "TB cases diagnosed and started/referred", "Waliothibitishwa na kuanza/kuelekezwa matibabu"),
        ("hcp_inmates_reached", "Inmates reached for quarterly screening", "Wafungwa waliofikiwa kwa uchunguzi wa robo mwaka"),
        ("hcp_inmates_screened", "Inmates screened for TB symptoms", "Wafungwa waliochunguzwa dalili za TB"),
        ("hcp_inmates_symptomatic", "Inmates with TB symptoms", "Wafungwa walioonyesha dalili za TB"),
        ("hcp_inmates_presumptive", "Presumptive TB inmates identified", "Wafungwa waliobainika na dalili za TB"),
        ("hcp_inmates_diagnosed_started", "Inmates diagnosed and started/referred", "Wafungwa waliothibitishwa na kuanza/kuelekezwa matibabu"),
        ("hcp_opd_attendees", "OPD attendees", "Wagonjwa waliohudhuria OPD"),
        ("hcp_opd_screened", "OPD attendees screened for HTS/TB", "Wagonjwa wa OPD waliochunguzwa HTS/TB"),
        ("hcp_opd_presumptive_tb", "Presumptive TB cases identified in OPD", "Wagonjwa wa OPD waliobainika na dalili za TB"),
        ("hcp_opd_tb_diagnosed_started", "OPD TB cases diagnosed and started/referred", "Wagonjwa wa OPD waliothibitishwa na kuanza/kuelekezwa matibabu"),
        ("hcp_art_initiated", "Clients newly initiated on ART", "Wateja wapya walioanzishiwa ART"),
        ("hcp_art_refill_appointments_served", "ART refill appointments served", "Miadi ya kujaza dawa za ART iliyohudumiwa"),
        ("hcp_cd4_samples_taken", "CD4 samples taken", "Sampuli za CD4 zilizochukuliwa"),
        ("hcp_hvl_samples_taken", "HVL samples taken", "Sampuli za HVL zilizochukuliwa"),
        ("hcp_lab_samples_received", "HVL/DBS/CD4 samples received", "Sampuli za HVL/DBS/CD4 zilizopokelewa"),
        ("hcp_lab_samples_processed", "HVL/DBS/CD4 samples processed", "Sampuli za HVL/DBS/CD4 zilizochakatwa"),
        ("hcp_lab_results_disbursed", "HVL/DBS/CD4 results disbursed", "Majibu ya HVL/DBS/CD4 yaliyotolewa"),
    ],
}

# The laboratory sheet separates HVL, DBS and CD4 rather than combining them
# into a single total, so the received → processed → disbursed cascade remains
# traceable for each sample type.
for sample in ("hvl", "dbs", "cd4"):
    for stage, english, swahili in (
        ("received", "samples received", "sampuli zilizopokelewa"),
        ("processed", "samples processed", "sampuli zilizochakatwa"),
        ("disbursed", "results disbursed", "majibu yaliyotolewa"),
    ):
        FIELD_SPECS["HCP"].append((f"hcp_lab_{sample}_{stage}", f"{sample.upper()} {english}", f"{sample.upper()} {swahili}"))

# Legacy aggregate rows remain readable for historical logs, but are not extra
# mandatory indicators in the updated activity-specific sheets.
OPTIONAL_LEGACY = {
    "index_testing": {"clients_tested_hiv", "clients_tested_positive_new"},
    "hiv_testing": {"clients_screened_hiv_tb", "clients_linked_hiv_tb_testing"},
}
for groups in ACTIVITIES.values():
    for activity in groups:
        activity["required_fields"] = [key for key in activity["fields"] if key not in OPTIONAL_LEGACY.get(activity["key"], set())]

CASCADES = {
    "hiv_testing": [
        ("chw_hiv_eligible", "chw_hiv_counselled", "HIV-testing eligibility exceeds counselling"),
        ("chw_hiv_positive", "chw_hiv_eligible", "New positives exceed clients eligible for HIV testing"),
        ("chw_hiv_linked_art", "chw_hiv_positive", "Linked-to-ART clients exceed new positives"),
    ],
    "index_testing": [
        ("clients_tested_index", "hcp_index_appointments", "Index contacts tested exceed appointments"),
        ("hcp_index_positive", "clients_tested_index", "Index positives exceed contacts tested"),
        ("hiv_positive_linked_art", "hcp_index_positive", "Index contacts linked exceed positives"),
    ],
    "sns_rnr_testing": [
        ("clients_tested_sns", "hcp_sns_appointments", "SNS-RNR contacts tested exceed appointments"),
        ("hcp_sns_positive", "clients_tested_sns", "SNS-RNR positives exceed contacts tested"),
        ("hiv_positive_linked_art", "hcp_sns_positive", "SNS-RNR contacts linked exceed positives"),
    ],
    "tb_contact_tracing": [
        ("hcp_tb_contacts_screened", "tb_contacts_traced", "TB contacts screened exceed contacts listed"),
        ("hcp_tb_contacts_presumptive", "hcp_tb_contacts_screened", "Presumptive TB contacts exceed contacts screened"),
        ("tb_samples_collected", "hcp_tb_contacts_presumptive", "TB samples exceed presumptive contacts"),
        ("hcp_tb_contacts_diagnosed_started", "tb_samples_collected", "TB cases diagnosed exceed samples collected"),
    ],
    "tb_active_case_finding": [
        ("hcp_tb_population_screened", "hcp_tb_population_mobilized", "People screened exceed people mobilized"),
        ("hcp_tb_active_presumptive", "hcp_tb_population_screened", "Presumptive TB exceeds people screened"),
        ("tb_samples_collected", "hcp_tb_active_presumptive", "TB samples exceed presumptive cases"),
        ("hcp_tb_active_diagnosed_started", "tb_samples_collected", "TB cases diagnosed exceed samples collected"),
    ],
    "inmate_tb_screening": [
        ("hcp_inmates_screened", "hcp_inmates_reached", "Inmates screened exceed inmates reached"),
        ("hcp_inmates_symptomatic", "hcp_inmates_screened", "Inmates with symptoms exceed inmates screened"),
        ("hcp_inmates_presumptive", "hcp_inmates_symptomatic", "Presumptive inmate TB exceeds inmates with symptoms"),
        ("tb_samples_collected", "hcp_inmates_presumptive", "TB samples exceed presumptive inmates"),
        ("hcp_inmates_diagnosed_started", "tb_samples_collected", "Inmates diagnosed exceed samples collected"),
    ],
    "opd_screening": [
        ("hcp_opd_screened", "hcp_opd_attendees", "OPD attendees screened exceed attendees"),
        ("clients_tested_opitc", "hcp_opd_screened", "OPD attendees tested exceed attendees screened"),
        ("clients_tested_positive_new", "clients_tested_opitc", "New positives exceed OPD attendees tested"),
        ("hiv_positive_linked_art", "clients_tested_positive_new", "OPD clients linked exceed new positives"),
        ("tb_samples_collected", "hcp_opd_presumptive_tb", "TB samples exceed presumptive OPD cases"),
        ("hcp_opd_tb_diagnosed_started", "tb_samples_collected", "OPD TB cases diagnosed exceed samples collected"),
    ],
    "weekend_clinic": [
        ("weekend_clinic_attended", "hcp_special_clinic_expected", "Clinic attendees served exceed expected attendees"),
    ],
    "laboratory": [
        (f"hcp_lab_{sample}_processed", f"hcp_lab_{sample}_received", f"{sample.upper()} samples processed exceed samples received")
        for sample in ("hvl", "dbs", "cd4")
    ] + [
        (f"hcp_lab_{sample}_disbursed", f"hcp_lab_{sample}_processed", f"{sample.upper()} results disbursed exceed samples processed")
        for sample in ("hvl", "dbs", "cd4")
    ],
}


def activity_for(cadre_code: str, key: str | None) -> dict | None:
    return next((activity for activity in ACTIVITIES.get(cadre_code, []) if activity["key"] == key), None)


def activity_fields(cadre_code: str, key: str | None, all_keys: set[str]) -> set[str]:
    activity = activity_for(cadre_code, key)
    return set(activity["fields"]) & all_keys if activity else all_keys
