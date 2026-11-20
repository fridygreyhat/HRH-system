"""Registering each kind of account: providers with their TIN and bank details; each office role with what it works on."""
import itertools

from backend.models import Staff, User, UserReviewCadre, UserScope
from .conftest import national_id
from .test_bank_only_cadres import _staff

_phones = itertools.count(301)


def phone():
    return f"0755 124 {next(_phones):03d}"


def office(api, username, roles, scopes=(), cadres=(), expect=None):
    return api.call("POST", "/admin/users", "admin", json={
        "username": username, "password": "Strong-pass-123", "full_name": username.replace(".", " ").title(),
        "phone": phone(), "roles": roles, "scopes": list(scopes), "review_cadre_ids": list(cadres)}, expect=expect)


def test_a_provider_is_registered_with_tin_bank_name_and_account_number(api, db):
    base = {**_staff(api, "CHW", phone(), "MOBILE_WALLET"), **national_id()}
    for path, payload in (("/staff", base), ("/admin/users", {"username": "no.bank", "password": "Strong-pass-123",
                                                               "full_name": "No Bank", "phone": base["verified_phone"],
                                                               "roles": ["PROVIDER"], "staff": base})):
        refused = api.call("POST", path, "central1" if path == "/staff" else "admin", json=payload, expect=422)
        assert "TIN, bank name, bank account number" in str(refused)
    api.call("POST", "/staff", "central1", json={**base, "tin_number": "200 300 401", "bank_name": "CRDB",
                                                  "bank_account_number": "12"}, expect=422)  # not an account number
    created = api.call("POST", "/staff", "central1", json={**base, "tin_number": "200 300 401", "bank_name": " CRDB ",
                                                            "bank_account_number": "0152 2789 4400"}, expect=201)
    staff = db.get(Staff, created["id"])
    assert (staff.tin_number, staff.bank_name, staff.bank_account_number) == ("200-300-401", "CRDB", "015227894400")
    # The CSO's salary file reads these as complete bank details (the branch is not asked for).
    from backend.services import provider_payment_details as pd
    assert pd.details(staff)["bank_name"] == "CRDB" and pd.details(staff)["bank_account_number"] == "015227894400"


def test_each_office_role_is_registered_with_what_it_works_on(api, db):
    region = api.get("/admin/regions", "admin")[0]["id"]
    facility = api.get("/admin/facilities", "admin")[0]["id"]
    cso = next(o for o in api.get("/admin/organizations", "admin") if o["type"] == "CSO")["id"]
    cadres = [c["id"] for c in api.get("/admin/cadres", "admin")]

    # Reviewer (CTC In-Charge): a facility.
    assert "facility" in str(office(api, "ctc.nofacility", ["SUPERVISOR"], [{"region_id": region}], expect=422))
    ctc = office(api, "ctc.reviewer", ["SUPERVISOR"], [{"facility_id": facility}], expect=201)
    # FHI360 technical officer: a region and the cadres of their technical area.
    assert "cadres" in str(office(api, "to.nocadres", ["TECHNICAL_OFFICER"], [{"region_id": region}], expect=422))
    office(api, "to.technical", ["TECHNICAL_OFFICER"], [{"region_id": region}], cadres[:1], expect=201)
    # CSO technical officer, who reviews community activities: their CSO, the regions they cover and the cadres.
    assert "CSO" in str(office(api, "csot.noregion", ["CSO_TECHNICAL_OFFICER"], [{"organization_id": cso}], cadres, expect=422))
    csot = office(api, "csot.community", ["CSO_TECHNICAL_OFFICER"], [{"organization_id": cso}, {"region_id": region}], cadres, expect=201)
    # Regional Manager and Regional Finance: a region. Central (FHI360) Finance: every region. CSO Finance: their CSO.
    office(api, "rm.noregion", ["RPM"], expect=422)
    office(api, "rm.manager", ["RPM"], [{"region_id": region}], expect=201)
    office(api, "rf.noregion", ["REGIONAL_FINANCE"], cadres=cadres, expect=422)
    office(api, "rf.finance", ["REGIONAL_FINANCE"], [{"region_id": region}], cadres, expect=201)
    office(api, "cf.central", ["FHI360_FINANCE"], cadres=cadres, expect=201)
    office(api, "csof.noorg", ["CSO_FINANCE"], cadres=cadres, expect=422)
    office(api, "csof.finance", ["CSO_FINANCE"], [{"organization_id": cso}], cadres, expect=201)
    # Admins: a regional admin has a region; a system admin has none.
    office(api, "ra.noregion", ["REGIONAL_ADMIN"], expect=422)
    office(api, "sa.system", ["SYSTEM_ADMIN"], expect=201)

    db.expire_all()
    stored = {(s.organization_id, s.region_id) for s in db.query(UserScope).filter_by(user_id=csot["id"])}
    assert stored == {(cso, None), (None, region)}
    assert {r.cadre_id for r in db.query(UserReviewCadre).filter_by(user_id=csot["id"])} == set(cadres)
    # Office accounts carry no staff record, so no TIN or bank details are asked of them.
    for user_id in (ctc["id"], csot["id"]):
        assert not db.query(Staff).filter_by(user_id=user_id).first()
    assert db.get(User, ctc["id"]).must_change_password
