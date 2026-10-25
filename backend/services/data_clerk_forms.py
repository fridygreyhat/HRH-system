"""Data Clerk roles 1–18, secondary-facility support and weekend clinic work."""
from copy import deepcopy


DATA_CLERK_GROUPS = [
    {"key": "ctc", "label_en": "CTC-2 and treatment data", "label_sw": "Takwimu za CTC-2 na matibabu",
     "color": "teal", "fields": [
         "ctc_clients_registered", "ctc_transfers_in", "ctc_appointments_expected",
         "ctc_visits_updated", "pharmacy_visits_entered", "ctc_clients_tb_screened",
         "ctc_tpt_eligible", "ctc_tpt_initiated", "hei_visits_updated",
     ]},
    {"key": "hts", "label_en": "HTS and contact data", "label_sw": "Takwimu za HTS na waliotajwa",
     "color": "blue", "fields": ["hts_clients_registered", "hts_clients_positive", "ctc_elicited_contacts"]},
    {"key": "laboratory", "label_en": "HVL / EID requests and results", "label_sw": "Maombi na majibu ya HVL / EID",
     "color": "violet", "fields": [
         "ctc_hvl_eligible", "ctc_eid_eligible", "ctc_hvl_requests", "ctc_eid_requests",
         "ctc_hvl_results_received", "ctc_eid_results_received",
     ]},
    {"key": "reporting", "label_en": "Backups and reporting", "label_sw": "Nakala za akiba na taarifa",
     "color": "amber", "fields": [
         "ctc_full_backup", "ctc_monthly_portal_submission",
         "ctc_nashcop_raw_export", "ctc_nashcop_aggregate_export",
     ]},
    {"key": "followup", "label_en": "Weekly lists and result sharing (optional)",
     "label_sw": "Orodha za wiki na kushirikisha majibu (si lazima)", "color": "rose",
     "fields": ["ctc_eligible_lists_shared", "ctc_hvl_eid_results_shared"]},
]
DATA_CLERK_REQUIRED = [key for group in DATA_CLERK_GROUPS[:4] for key in group["fields"]]
DATA_CLERK_KEYS = {"data_clerk_daily_timesheet", "data_clerk_secondary_facility", "data_clerk_weekend_clinic"}
DATA_CLERK_CASCADES = [
    ("ctc_tpt_initiated", "ctc_tpt_eligible", "TPT initiations exceed eligible clients"),
    ("hts_clients_positive", "hts_clients_registered", "HIV-positive clients exceed HTS entries"),
]


def clerk_metadata(item):
    """Also used for approved rates sourced from these templates."""
    keys = set(item["fields"])
    item.update(
        groups=[{**deepcopy(group), "fields": [key for key in group["fields"] if key in keys]}
                for group in DATA_CLERK_GROUPS if keys.intersection(group["fields"])],
        required_fields=[key for key in DATA_CLERK_REQUIRED if key in keys],
        cascade_pairs=deepcopy(DATA_CLERK_CASCADES),
        requires_location=(item.get("source_key") or item["key"]) == "data_clerk_secondary_facility",
    )
    return item


def data_clerk_builtins(fields, cadre_id):
    fields = deepcopy(fields)
    fields["ctc_clients_registered"].update(
        label_en="New CTC clients registered in CTC-2 (CARE_NEW)",
        label_sw="Wateja wapya waliosajiliwa kwenye CTC-2 (CARE_NEW)",
    )
    keys = [key for group in DATA_CLERK_GROUPS for key in group["fields"]]
    result = []
    for key, en, sw, kind in [
        ("data_clerk_daily_timesheet", "Daily Data Clerk timesheet", "Daftari la kila siku la Data Clerk", "PAYROLL"),
        ("data_clerk_secondary_facility", "Data entry at a secondary facility", "Uingizaji wa takwimu katika kituo kingine", "PAYROLL"),
        ("data_clerk_weekend_clinic", "Weekend Clinics", "Kliniki za mwisho wa wiki", "SERVICES"),
    ]:
        result.append(clerk_metadata({
            "key": key, "label_en": en, "label_sw": sw, "item_type": kind, "cadre_id": cadre_id,
            "fields": list(keys), "field_definitions": [deepcopy(fields[field]) for field in keys],
            "form_mode": "CASCADE", "hours_input": False, "unit_type": "PER_HOUR",
            "rate_value": None, "currency": "TZS", "billable_field": None,
        }))
    return result
