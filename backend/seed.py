"""Idempotent seed.

Always: roles, sections, the three cadre forms (every row of the supplied CHW, Data Clerk and HCP sheets),
payment routes A/B/C, default SMS templates (v1), the FHI360 organization and the bootstrap system administrator.
No rates, budgets or route mappings are seeded for production — those are HRH decisions to configure.

SEED_DEMO_DATA=true adds a demo region, facilities, CSOs, one user per role and clearly labelled DEMO
categories, rates and budgets so the end-to-end flow can be exercised. Demo rates are illustrative only.

Run: python -m backend.seed
"""
import logging
import os
from datetime import date, timedelta

from sqlalchemy.orm import Session

from .core import config
from .core.roles import (
    CENTRAL_ADMIN, COMMUNITY_VERIFIER, CSO_FINANCE, FACILITY_IN_CHARGE, FHI360_FINANCE, OVERSIGHT, PROVIDER,
    REGIONAL_ADMIN, ROLE_DESCRIPTIONS, RPM, SUPERVISOR, SYSTEM_ADMIN, TECHNICAL_OFFICER,
)
from .core.security import hash_password
from .core.timeutil import local_today
from .db.session import SessionLocal
from .models import (
    BudgetLine, BudgetTransaction, Cadre, CadreFormField, ClaimCategory, Cluster, CommunityArea, District, Facility,
    FundingSource, Organization, PaymentRoute, PayPeriod, RateRule, Region, Role, Section, SMSTemplate, Staff,
    StaffAssignment, User, UserRole, UserScope, Ward, utcnow,
)
from .services.templates import EVENTS, LANGUAGES, PROTECTED_EVENTS

logger = logging.getLogger(__name__)
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "Demo@12345")

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


def _user(db: Session, username: str, full_name: str, phone: str, roles: list[str], password: str, scopes: list[dict] = ()) -> User:
    user, created = _get_or_create(db, User, username=username, defaults={"hashed_password": hash_password(password), "full_name": full_name, "phone": phone})
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
    _user(db, config.ADMIN_USERNAME, "System Administrator", config.ADMIN_PHONE, [SYSTEM_ADMIN], config.ADMIN_PASSWORD)
    db.flush()
    if config.SEED_DEMO_DATA:
        _seed_demo(db)
    db.commit()


def _month(start: date) -> tuple[date, date]:
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return start, end


def _seed_demo(db: Session) -> None:
    if db.query(User).filter(User.username == "chw1").first():
        return
    logger.warning("Seeding DEMO data. All demo users share the password in DEMO_PASSWORD.")
    pw = DEMO_PASSWORD
    fhi360 = db.query(Organization).filter(Organization.type == "FHI360").one()
    cso, _ = _get_or_create(db, Organization, name="DEMO CSO Iringa", defaults={"type": "CSO", "code": "DEMO-CSO-1"})
    other_cso, _ = _get_or_create(db, Organization, name="DEMO CSO Njombe", defaults={"type": "CSO", "code": "DEMO-CSO-2"})
    region, _ = _get_or_create(db, Region, name="Iringa")
    other_region, _ = _get_or_create(db, Region, name="Njombe")
    cluster, _ = _get_or_create(db, Cluster, name="Iringa Cluster 1", defaults={"region_id": region.id})
    district, _ = _get_or_create(db, District, name="Iringa Municipal", defaults={"region_id": region.id})
    other_district, _ = _get_or_create(db, District, name="Njombe Town", defaults={"region_id": other_region.id})
    ward, _ = _get_or_create(db, Ward, name="Gangilonga", defaults={"district_id": district.id})
    other_ward, _ = _get_or_create(db, Ward, name="Ramadhani", defaults={"district_id": other_district.id})
    facility, _ = _get_or_create(db, Facility, name="DEMO Iringa Dispensary", defaults={
        "ward_id": ward.id, "cluster_id": cluster.id, "facility_type": "PUBLIC",
        "geofence_lat": -7.7700, "geofence_lon": 35.6900, "geofence_radius_meters": 300})
    other_facility, _ = _get_or_create(db, Facility, name="DEMO Njombe Health Centre", defaults={"ward_id": other_ward.id, "facility_type": "PUBLIC"})
    area, _ = _get_or_create(db, CommunityArea, name="DEMO Gangilonga Community", defaults={"district_id": district.id, "ward_id": ward.id})
    chw, clerk, hcp = (db.query(Cadre).filter(Cadre.code == c).one() for c in ("CHW", "DATA_CLERK", "HCP"))

    start = date(2020, 1, 1)
    providers = [
        ("chw1", "Neema", "J.", "Mollel", "+255710000101", chw, None, {"region_id": region.id, "district_id": district.id, "ward_id": ward.id, "facility_id": facility.id, "community_area_id": area.id, "organization_id": cso.id}),
        ("clerk1", "Baraka", None, "Mushi", "+255710000102", clerk, "Data Clerk", {"region_id": region.id, "district_id": district.id, "ward_id": ward.id, "facility_id": facility.id, "section": "CTC", "organization_id": cso.id}),
        ("hcp1", "Rehema", "A.", "Kileo", "+255710000103", hcp, "Nurse", {"region_id": region.id, "district_id": district.id, "ward_id": ward.id, "facility_id": facility.id, "section": "OPD", "organization_id": cso.id}),
        ("hcp2", "Daudi", None, "Mbwambo", "+255710000104", hcp, "Clinician", {"region_id": other_region.id, "district_id": other_district.id, "ward_id": other_ward.id, "facility_id": other_facility.id, "section": "CTC", "organization_id": other_cso.id}),
    ]
    for username, first, middle, last, phone, cadre, occupation, assignment in providers:
        user = _user(db, username, " ".join(p for p in (first, middle, last) if p), phone, [PROVIDER], pw)
        staff = Staff(user_id=user.id, cadre_id=cadre.id, first_name=first, middle_name=middle, last_name=last, verified_phone=phone,
                      occupation=occupation, salary_scale="DEMO-1" if cadre.code != "CHW" else None, employment_start_date=start,
                      enrollment_source="MANUAL", payment_method="MOBILE_WALLET", payment_provider="DEMO Wallet", payment_account=phone)
        db.add(staff)
        db.flush()
        db.add(StaffAssignment(staff_id=staff.id, start_date=start, **assignment))

    staff_users = [
        ("central1", "Central Admin", "+255710000201", [CENTRAL_ADMIN], []),
        ("regadmin1", "Iringa Regional Admin", "+255710000202", [REGIONAL_ADMIN], [{"region_id": region.id}]),
        ("supervisor1", "CTC In-Charge Iringa", "+255710000203", [SUPERVISOR], [{"facility_id": facility.id}, {"community_area_id": area.id}]),
        ("facilityic1", "Facility In-Charge Iringa", "+255710000204", [FACILITY_IN_CHARGE], [{"facility_id": facility.id}]),
        ("tofficer1", "Technical Officer Iringa", "+255710000205", [TECHNICAL_OFFICER], [{"cluster_id": cluster.id}]),
        ("rpm1", "RPM Iringa", "+255710000206", [RPM], [{"region_id": region.id}]),
        ("rpm2", "RPM Njombe", "+255710000207", [RPM], [{"region_id": other_region.id}]),
        ("fhifin1", "FHI360 Finance Officer", "+255710000208", [FHI360_FINANCE], [{"organization_id": fhi360.id}]),
        ("fhifin2", "FHI360 Finance Approver", "+255710000209", [FHI360_FINANCE], [{"organization_id": fhi360.id}]),
        ("csofin1", "CSO Iringa Finance Officer", "+255710000210", [CSO_FINANCE], [{"organization_id": cso.id}]),
        ("csofin2", "CSO Iringa Finance Approver", "+255710000211", [CSO_FINANCE], [{"organization_id": cso.id}]),
        ("csofin3", "CSO Njombe Finance Officer", "+255710000212", [CSO_FINANCE], [{"organization_id": other_cso.id}]),
        ("verifier1", "Community Verifier Gangilonga", "+255710000213", [COMMUNITY_VERIFIER], [{"community_area_id": area.id}]),
        ("oversight1", "FHI360 Oversight", "+255710000214", [OVERSIGHT], []),
    ]
    for username, name, phone, roles, scopes in staff_users:
        _user(db, username, name, phone, roles, pw, scopes)
    db.flush()
    oversight = db.query(User).filter(User.username == "oversight1").one()
    fin = db.query(User).filter(User.username == "fhifin1").one()

    today = local_today()
    this_month = _month(today.replace(day=1))
    last_month = _month((today.replace(day=1) - timedelta(days=1)).replace(day=1))
    periods = []
    for s, e in (last_month, this_month):
        p, _ = _get_or_create(db, PayPeriod, start_date=s, end_date=e, defaults={"period_label": s.strftime("%B %Y")})
        periods.append(p)

    funding, _ = _get_or_create(db, FundingSource, code="DEMO-FUND", defaults={"name": "DEMO funding source"})
    routes = {r.code: r for r in db.query(PaymentRoute)}
    cat_a, _ = _get_or_create(db, ClaimCategory, name="DEMO – PnP activity (Route A)", defaults={
        "form_type": "CHW_PNP", "route_id": routes["A"].id, "funding_source_id": funding.id, "payor_org_id": fhi360.id,
        "budget_owner": "PAYOR", "origin_channel": "FACILITY", "budget_line_code": "DEMO-A-01", "requires_work_log": True})
    cat_b, _ = _get_or_create(db, ClaimCategory, name="DEMO – Facility payroll (Route B)", defaults={
        "form_type": "SALARY", "route_id": routes["B"].id, "funding_source_id": funding.id, "payor_org_id": fhi360.id,
        "budget_owner": "EXECUTOR", "origin_channel": "FACILITY", "budget_line_code": "DEMO-B-01", "requires_work_log": True})
    cat_c, _ = _get_or_create(db, ClaimCategory, name="DEMO – Community service (Route C)", defaults={
        "form_type": "COMMUNITY_SERVICE", "route_id": routes["C"].id, "funding_source_id": funding.id,
        "budget_owner": "EXECUTOR", "origin_channel": "COMMUNITY", "budget_line_code": "DEMO-C-01", "requires_work_log": False})

    def rule(category, component, unit, rate, cadre=None, measure=None):
        db.add(RateRule(category_id=category.id, cadre_id=cadre.id if cadre else None, component_name=component, unit_type=unit,
                        measure_key=measure, rate_value=rate, effective_start_date=start, status="ACTIVE", created_by=fin.id,
                        approved_by=oversight.id, approved_at=utcnow()))

    rule(cat_a, "DEMO transport", "FIXED", 10000)
    rule(cat_a, "DEMO daily allowance", "PER_DAY", 15000)
    rule(cat_b, "DEMO hourly rate", "PER_HOUR", 2500)
    rule(cat_c, "DEMO service days", "PER_DAY", 8000)
    rule(cat_c, "DEMO clients reached", "PER_UNIT", 500, cadre=chw, measure="clients_followed_up")

    for period in periods:
        for code, name, org, category, amount, source in (
            ("DEMO-A-01", "DEMO FHI360 PnP activities", fhi360, cat_a, 5_000_000, "FHI360_TRACKER"),
            ("DEMO-B-01", "DEMO CSO Iringa facility payroll", cso, cat_b, 3_000_000, "CSO"),
            ("DEMO-C-01", "DEMO CSO Iringa community services", cso, cat_c, 1_000_000, "CSO"),
            ("DEMO-B-01", "DEMO CSO Njombe facility payroll", other_cso, cat_b, 2_000_000, "CSO"),
        ):
            line = BudgetLine(code=code, name=name, source=source, organization_id=org.id, category_id=category.id, period_id=period.id,
                              allocated_amount=amount, sync_status="UNSYNCED" if source == "FHI360_TRACKER" else "NOT_APPLICABLE")
            db.add(line)
            db.flush()
            db.add(BudgetTransaction(budget_line_id=line.id, kind="ALLOCATE", amount=amount, reason="DEMO allocation"))


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    with SessionLocal() as db:
        seed(db)
    logger.info("Seed complete")


if __name__ == "__main__":
    main()
