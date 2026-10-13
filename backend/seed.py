"""Idempotent seed.

Always: roles, sections, the three cadre forms (every row of the supplied CHW, Data Clerk and HCP sheets),
every Tanzanian region, district and ward (backend/data/tz_locations.csv), payment routes A/B/C, default SMS templates (v1), the FHI360 organization and the bootstrap system administrator.
No rates, budgets or route mappings are seeded for production — those are HRH decisions to configure.

Run: python -m backend.seed
"""
import csv
import logging
from pathlib import Path

from sqlalchemy.orm import Session

from .core import config
from .core.roles import ROLE_DESCRIPTIONS, SUPER_ADMIN, SYSTEM_ADMIN
from .core.security import hash_password
from .db.session import SessionLocal
from .models import Cadre, CadreFormField, District, Organization, PaymentRoute, Role, Region, Section, SMSTemplate, User, UserRole, UserScope, Ward
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
        "technical_reviewer_title": "Senior Regional Technical Officer, Community Engagement",
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
        "technical_reviewer_title": "Regional Strategic Information Officer",
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
        "technical_reviewer_title": "Senior Regional Technical Officer, Care & Treatment",
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

# Services paid by FHI360 per client, recorded in the work log's Services section. Every cadre starts enabled;
# admins narrow them (or add services) under Admin → Services. Kiswahili labels should be reviewed by a native speaker.
SERVICES = [
    ("svc_sns_testing", "SNS testing (clients tested)", "Upimaji wa SNS (wateja waliopimwa)"),
    ("svc_index_testing", "Index testing (clients tested)", "Upimaji wa Index (wateja waliopimwa)"),
    ("svc_weekend_clinic", "Weekend clinic (clients served)", "Kliniki ya mwisho wa wiki (wateja waliohudumiwa)"),
    ("svc_tb_outreach", "TB outreach (clients reached)", "Huduma za TB kwa jamii (wateja waliofikiwa)"),
    ("svc_cart_refill", "CART refill (clients refilled)", "Ujazaji wa dawa CART (wateja waliojaziwa)"),
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


LOCATIONS_CSV = Path(__file__).parent / "data" / "tz_locations.csv"


def _seed_locations(db: Session) -> None:
    """Regions, districts and wards from the national gazetteer. Matched by name, so admin edits and additions are kept."""
    regions = {r.name.lower(): r for r in db.query(Region)}
    districts = {(d.region_id, d.name.lower()): d for d in db.query(District)}
    wards = {(w.district_id, w.name.lower()) for w in db.query(Ward)}
    with open(LOCATIONS_CSV, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            region = regions.get(row["region"].lower())
            if not region:
                region = regions[row["region"].lower()] = Region(name=row["region"])
                db.add(region)
                db.flush()
            district = districts.get((region.id, row["district"].lower()))
            if not district:
                district = districts[(region.id, row["district"].lower())] = District(region_id=region.id, name=row["district"])
                db.add(district)
                db.flush()
            if (district.id, row["ward"].lower()) not in wards:
                wards.add((district.id, row["ward"].lower()))
                db.add(Ward(district_id=district.id, name=row["ward"]))


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
    db.flush()
    for order, (key, en, sw) in enumerate(SERVICES, start=1000):
        if not db.query(CadreFormField).filter(CadreFormField.key == key).first():  # never undo an admin's choice of cadres
            for cadre in db.query(Cadre):
                db.add(CadreFormField(cadre_id=cadre.id, key=key, label_en=en, label_sw=sw, sort_order=order, field_type="INTEGER", is_service=True))
    for code, name, description in ROUTES:
        _get_or_create(db, PaymentRoute, code=code, defaults={"name": name, "description": description})
    for event, meta in EVENTS.items():
        if event in PROTECTED_EVENTS:
            continue
        for lang in LANGUAGES:
            _get_or_create(db, SMSTemplate, event_name=event, language=lang, version=1, defaults={"template_text": meta[lang], "is_active": True})
    _seed_locations(db)
    _get_or_create(db, Organization, name="FHI360", defaults={"type": "FHI360", "code": "FHI360"})
    # The bootstrap password is configuration (and its default is public), so it must be replaced at first sign-in.
    if not db.query(User).filter(User.username == config.ADMIN_USERNAME).first() and (len(config.ADMIN_PASSWORD) < 12 or config.ADMIN_PASSWORD == "admin12345"):
        raise RuntimeError("Set ADMIN_PASSWORD (12+ characters, not the published default) to create the first administrator")
    _user(db, config.ADMIN_USERNAME, "System Administrator", config.ADMIN_PHONE, [SYSTEM_ADMIN, SUPER_ADMIN], config.ADMIN_PASSWORD, must_change_password=True)
    db.commit()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    with SessionLocal() as db:
        seed(db)
    logger.info("Seed complete")


if __name__ == "__main__":
    main()
