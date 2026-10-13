"""Sample data for the acceptance tests only (never seeded in a real deployment).

Creates two regions, facilities, CSOs, one user per role, pay periods, illustrative categories, approved rate
rules and budgets, so the full workflow can be exercised end to end.
"""
from datetime import date, timedelta

from sqlalchemy.orm import Session

from backend.core.roles import (
    CENTRAL_ADMIN, COMMUNITY_VERIFIER, CSO_FINANCE, FACILITY_IN_CHARGE, FHI360_FINANCE, OVERSIGHT, PROVIDER,
    REGIONAL_ADMIN, RPM, SUPERVISOR, TECHNICAL_OFFICER,
)
from backend.core.security import hash_password
from backend.core.timeutil import local_today
from backend.models import (
    BudgetLine, BudgetTransaction, Cadre, ClaimCategory, Cluster, CommunityArea, District, Facility, FundingSource,
    Organization, PaymentRoute, PayPeriod, RateRule, Region, Role, Staff, StaffAssignment, User, UserReviewCadre, UserRole, UserScope, Ward,
    utcnow,
)

DEMO_PASSWORD = "Demo@12345"


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


def _month(start: date) -> tuple[date, date]:
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return start, end


def seed_test_data(db: Session) -> None:
    if db.query(User).filter(User.username == "chw1").first():
        return
    pw = DEMO_PASSWORD
    fhi360 = db.query(Organization).filter(Organization.type == "FHI360").one()
    cso, _ = _get_or_create(db, Organization, name="DEMO CSO Iringa", defaults={"type": "CSO", "code": "DEMO-CSO-1"})
    other_cso, _ = _get_or_create(db, Organization, name="DEMO CSO Njombe", defaults={"type": "CSO", "code": "DEMO-CSO-2"})
    region, _ = _get_or_create(db, Region, name="Iringa")
    other_region, _ = _get_or_create(db, Region, name="Njombe")
    cluster, _ = _get_or_create(db, Cluster, name="Iringa Cluster 1", defaults={"region_id": region.id})
    # Real gazetteer names (seeded from backend/data/tz_locations.csv); ward names repeat, so look up inside the parent.
    district, _ = _get_or_create(db, District, name="Iringa Urban", region_id=region.id)
    other_district, _ = _get_or_create(db, District, name="Njombe Urban", region_id=other_region.id)
    ward, _ = _get_or_create(db, Ward, name="Gangilonga", district_id=district.id)
    other_ward, _ = _get_or_create(db, Ward, name="Ramadhani", district_id=other_district.id)
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
    tofficer = db.query(User).filter(User.username == "tofficer1").one()
    for cadre in db.query(Cadre):  # one officer covers every cadre's technical review in the tests
        _get_or_create(db, UserReviewCadre, user_id=tofficer.id, cadre_id=cadre.id)
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
        "form_type": "HOURLY_PAYROLL", "route_id": routes["B"].id, "funding_source_id": funding.id, "payor_org_id": fhi360.id,
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
    db.commit()
