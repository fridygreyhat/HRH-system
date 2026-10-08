"""Idempotent seed.

Always: roles, sections, the three cadre forms (every row of the supplied CHW, Data Clerk and HCP sheets),
payment routes A/B/C, default SMS templates (v1), the FHI360 organization and the bootstrap system administrator.
No rates, budgets or route mappings are seeded for production — those are HRH decisions to configure.

Run: python -m backend.seed
"""
import logging

from sqlalchemy.orm import Session

from .core import config
from .core.roles import ROLE_DESCRIPTIONS, SYSTEM_ADMIN
from .core.security import hash_password
from .db.session import SessionLocal
from .models import Cadre, CadreFormField, Organization, PaymentRoute, Role, Section, SMSTemplate, User, UserRole, UserScope
from .services.templates import EVENTS, LANGUAGES, PROTECTED_EVENTS

logger = logging.getLogger(__name__)

SECTIONS = [("CTC", "CTC"), ("OPD", "OPD"), ("RCH", "RCH"), ("IPD", "IPD"), ("NGP", "Non-Government Provider")]

# Rows of the supplied paper forms, in order. Swahili labels for the Data Clerk and HCP forms (which are in
# English on paper) are translations and should be reviewed by a native speaker.
CADRES = [
    {
        "code": "CHW", "name": "Community Health Worker", "form_title": "EpiC Project Weekly Work Log-Sheet – CHW",
        "hours_mode": "DIRECT", "uses_facility_geofence": False, "requires_facility_endorsement": False,
        "uses_section": False, "occupation_options": [],
        "fields": [
            ("clients_screened_hiv_tb", "Clients screened for HIV and TB testing indicators", "Idadi ya Wateja Waliochunguzwa viashiria vya upimaji wa VVU na TB"),
            ("clients_linked_hiv_tb_testing", "Clients linked to HIV and TB testing services", "Idadi ya wateja waliunganishwa na huduma ya upimaji wa VVU na TB"),
            ("ltfu_clients_assigned", "Lost-to-follow-up clients assigned for tracing", "Idadi ya wateja waliopotea kwenye huduma uliopewa kuwafuatilia"),
            ("clients_followed_up", "Clients followed up", "Idadi ya wateja uliowafuatilia"),
            ("clients_returned_to_care", "Clients returned to care and treatment services", "Idadi ya Wateja Waliorudi kwenye Huduma za tiba na matunzo"),
        ],
    },
    {
        "code": "DATA_CLERK", "name": "Data Clerk", "form_title": "Weekly Work Log-Sheet – Data Clerks",
        "hours_mode": "START_END", "uses_facility_geofence": True, "requires_facility_endorsement": False,
        "uses_section": True, "occupation_options": ["Data Clerk", "Data Entry Volunteer", "ART Nurse / Clinician", "Other"],
        "fields": [
            ("ctc_clients_registered", "Number of CTC clients registered per day", "Idadi ya wateja wa CTC waliosajiliwa kwa siku"),
            ("ctc_visits_updated", "Number of CTC visits updated in the database per day", "Idadi ya mahudhurio ya CTC yaliyosasishwa kwenye kanzidata kwa siku"),
            ("hts_clients_registered", "Number of HTS clients registered in the HTS Module", "Idadi ya wateja wa HTS waliosajiliwa kwenye moduli ya HTS"),
            ("pharmacy_visits_entered", "Number of Pharmacy visits entered", "Idadi ya mahudhurio ya famasia yaliyoingizwa"),
            ("ctc_hts_dataset_uploaded", "CTC and HTS dataset uploaded (Yes/No)", "Takwimu za CTC na HTS zimepakiwa (Ndiyo/Hapana)", "BOOLEAN"),
        ],
    },
    {
        "code": "HCP", "name": "Health Care Provider", "form_title": "EpiC Project Weekly Work Log-Sheet",
        "hours_mode": "START_END", "uses_facility_geofence": True, "requires_facility_endorsement": True,
        "uses_section": True, "occupation_options": ["Nurse", "Clinician", "Lab Tech", "Other"],
        "fields": [
            ("clients_reached_community", "Number of Clients Reached (For Community)", "Idadi ya wateja waliofikiwa (jamii)"),
            ("clients_tested_hiv", "Number of clients Tested For HIV", "Idadi ya wateja waliopimwa VVU"),
            ("clients_tested_index", "Number of clients tested – Index", "Idadi ya wateja waliopimwa – Index"),
            ("clients_tested_sns", "Number of clients tested – SNS", "Idadi ya wateja waliopimwa – SNS"),
            ("clients_tested_opitc", "Number of clients tested – oPITC", "Idadi ya wateja waliopimwa – oPITC"),
            ("clients_tested_positive_new", "Number of clients tested Positive (New cases)", "Idadi ya wateja waliokutwa na VVU (wapya)"),
            ("clients_known_cases", "Number of clients Known cases", "Idadi ya wateja wanaojulikana kuwa na VVU"),
            ("hiv_positive_linked_art", "Number of HIV+ Clients Linked to ART", "Idadi ya wateja wenye VVU walioanzishiwa ART"),
            ("hivst_distributed", "Number of HIVST Oral/Blood distributed", "Idadi ya vipimo binafsi vya VVU (mdomo/damu) vilivyogawiwa"),
            ("clients_attended_ctc", "Number of Clients attended CTC Clinic", "Idadi ya wateja waliohudhuria kliniki ya CTC"),
            ("tb_contacts_traced", "Number of TB contacts traced", "Idadi ya watu wa karibu wa wagonjwa wa TB waliofuatiliwa"),
            ("tb_samples_collected", "Number of samples collected for TB diagnosis", "Idadi ya sampuli zilizochukuliwa kwa uchunguzi wa TB"),
            ("weekend_clinic_attended", "Number of clients who attended the weekend clinic", "Idadi ya wateja waliohudhuria kliniki ya mwisho wa wiki"),
        ],
    },
]

ROUTES = [
    ("A", "FHI360-funded activity payments", "Configured activity-based payments prepared for and recorded by FHI360 Finance"),
    ("B", "Facility payroll: facility → FHI360 → CSO", "FHI360 processes and hands off approved payroll to the assigned CSO, which pays and records proof"),
    ("C", "Community service claim managed by CSO", "Community-originated claims verified, managed and paid by the assigned CSO"),
]


def _get_or_create(db: Session, model, defaults=None, **lookup):
    row = db.query(model).filter_by(**lookup).first()
    if row:
        return row, False
    row = model(**lookup, **(defaults or {}))
    db.add(row)
    db.flush()
    return row, True


def _user(db: Session, username: str, full_name: str, phone: str, roles: list[str], password: str, scopes: list[dict] = (), must_change_password: bool = False) -> User:
    user, created = _get_or_create(db, User, username=username, defaults={
        "hashed_password": hash_password(password), "full_name": full_name, "phone": phone, "must_change_password": must_change_password})
    if created:
        for role in db.query(Role).filter(Role.name.in_(roles)):
            db.add(UserRole(user_id=user.id, role_id=role.id))
        for scope in scopes:
            db.add(UserScope(user_id=user.id, **scope))
    return user


def seed(db: Session) -> None:
    for name, description in ROLE_DESCRIPTIONS.items():
        _get_or_create(db, Role, name=name, defaults={"description": description})
    for code, name in SECTIONS:
        _get_or_create(db, Section, code=code, defaults={"name": name})
    for spec in CADRES:
        cadre, _ = _get_or_create(db, Cadre, code=spec["code"], defaults={k: v for k, v in spec.items() if k not in ("code", "fields")})
        for order, field in enumerate(spec["fields"]):
            key, en, sw, *ftype = field
            _get_or_create(db, CadreFormField, cadre_id=cadre.id, key=key, defaults={"label_en": en, "label_sw": sw, "sort_order": order, "field_type": ftype[0] if ftype else "INTEGER"})
    for code, name, description in ROUTES:
        _get_or_create(db, PaymentRoute, code=code, defaults={"name": name, "description": description})
    for event, meta in EVENTS.items():
        if event in PROTECTED_EVENTS:
            continue
        for lang in LANGUAGES:
            _get_or_create(db, SMSTemplate, event_name=event, language=lang, version=1, defaults={"template_text": meta[lang], "is_active": True})
    _get_or_create(db, Organization, name="FHI360", defaults={"type": "FHI360", "code": "FHI360"})
    # The bootstrap password is configuration (and its default is public), so it must be replaced at first sign-in.
    _user(db, config.ADMIN_USERNAME, "System Administrator", config.ADMIN_PHONE, [SYSTEM_ADMIN], config.ADMIN_PASSWORD, must_change_password=True)
    db.commit()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    with SessionLocal() as db:
        seed(db)
    logger.info("Seed complete")


if __name__ == "__main__":
    main()
