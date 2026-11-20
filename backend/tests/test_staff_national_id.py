"""A health worker is registered with their National ID (NIDA) or Voter ID; one number belongs to one person only."""
import pytest

from backend.core.national_id import id_number, identity
from backend.models import AuditEvent, Staff
from .test_bank_only_cadres import _staff


def test_numbers_are_checked_and_kept_in_one_form():
    assert id_number("NIDA", "1990 0101 1234 5123 4512") == "19900101-12345-12345-12"
    assert id_number("NIDA", "19900101-12345-12345-12") == "19900101-12345-12345-12"
    assert id_number("VOTER", " t-1000-1234-567 ") == "T-1000-1234-567"
    for kind, value in (("NIDA", "12345"), ("NIDA", "1990010112345123451A"), ("VOTER", "T1"), ("VOTER", "T 1000/1234")):
        with pytest.raises(ValueError):
            id_number(kind, value)
    assert identity("National ID", "19900101123451234512", required=True) == ("NIDA", "19900101-12345-12345-12")
    assert identity(None, None, required=False) == (None, None)
    for kind, number in ((None, None), ("NIDA", None), (None, "19900101123451234512")):
        with pytest.raises(ValueError):
            identity(kind, number, required=True)


def test_registration_needs_the_id_and_refuses_a_number_already_used(api, db):
    body = {**_staff(api, "CHW", "0755 301 701", "MOBILE_WALLET"), "occupation": "CHW (HIV + TB)"}
    missing = api.post("/staff", "central1", {**body, "id_type": None, "id_number": None}, expect=422)
    assert "National ID (NIDA) or Voter ID" in str(missing)
    assert "20-digit" in str(api.post("/staff", "central1", {**body, "id_type": "NIDA", "id_number": "1234"}, expect=422))
    created = api.post("/staff", "central1", {**body, "id_type": "NIDA", "id_number": "19850505 22222 33333 44"}, expect=201)
    record = db.get(Staff, created["id"])
    assert (record.id_type, record.id_number) == ("NIDA", "19850505-22222-33333-44")

    again = {**body, "verified_phone": "0755 301 702", "id_type": "NIDA", "id_number": "19850505222223333344"}
    assert "already has this ID" in str(api.post("/staff", "central1", again, expect=409))
    voter = api.post("/staff", "central1", {**again, "id_type": "VOTER", "id_number": "T-1000-5555-701"}, expect=201)
    assert db.get(Staff, voter["id"]).id_type == "VOTER"

    # The audit keeps the last digits only.
    event = db.query(AuditEvent).filter_by(entity_type="staff", entity_id=str(created["id"]), action="create").one()
    assert "19850505-22222" not in str(event.after) and "•••3-44" in str(event.after)


def test_people_without_contact_access_see_the_last_digits_only(api):
    created = api.post("/staff", "central1", {**_staff(api, "CHW", "0755 301 703", "MOBILE_WALLET"),
                                              "id_type": "VOTER", "id_number": "T-1000-5555-703"}, expect=201)
    assert api.get(f"/staff/{created['id']}", "central1")["id_number"] == "T-1000-5555-703"
    assert api.get(f"/staff/{created['id']}", "oversight1")["id_number"] == "•••-703"


def test_an_id_is_added_to_an_existing_record_and_cannot_be_removed(api, db):
    created = api.post("/staff", "central1", {**_staff(api, "CHW", "0755 301 704", "MOBILE_WALLET")}, expect=201)
    staff = db.get(Staff, created["id"])
    staff.id_type = staff.id_number = None  # registered before the ID was asked for
    db.commit()
    saved = api.call("PATCH", f"/staff/{created['id']}", "central1",
                     {"changes": {"id_type": "VOTER", "id_number": "t-1000-5555-704"}, "reason": "ID card seen"})
    assert saved["applied"] is True
    assert api.get(f"/staff/{created['id']}", "central1")["id_number"] == "T-1000-5555-704"
    api.call("PATCH", f"/staff/{created['id']}", "central1",
             {"changes": {"id_type": None, "id_number": None}, "reason": "remove"}, expect=422)
    fixed = api.call("PATCH", f"/staff/{created['id']}", "central1",
                     {"changes": {"id_type": "NIDA", "id_number": "19770707111112222233"}, "reason": "NIDA card issued"})
    assert fixed["applied"] is True
    assert api.get(f"/staff/{created['id']}", "central1")["id_number"] == "19770707-11111-22222-33"


def test_roster_import_needs_the_id_for_new_people_only(api, db):
    head = "first_name,last_name,phone,cadre,region,start_date,id_type,id_number\n"
    rows = ("Roster,WithId,0799 000 601,CHW,Iringa,2023-01-01,NIDA,19800808-12121-34343-56\n"
            "Roster,NoId,0799 000 602,CHW,Iringa,2023-01-01,,\n")
    result = api.call("POST", "/staff/import", "central1", files={"file": ("roster.csv", head + rows, "text/csv")}, expect=201)
    assert (result["created_count"], result["error_count"]) == (1, 1)
    assert "National ID (NIDA) or Voter ID" in result["errors"][0]["error"]
    # Someone already registered without an ID: the roster fills it in; a different one is refused.
    person = db.query(Staff).filter_by(verified_phone="+255799000601").one()
    person.id_type = person.id_number = None
    db.commit()
    again = api.call("POST", "/staff/import", "central1", files={"file": ("roster.csv", head + (
        "Roster,WithId,0799 000 601,CHW,Iringa,2023-01-01,VOTER,T-1000-0799-601\n"), "text/csv")}, expect=201)
    assert again["error_count"] == 0
    db.expire_all()
    assert db.query(Staff).filter_by(verified_phone="+255799000601").one().id_number == "T-1000-0799-601"
    refused = api.call("POST", "/staff/import", "central1", files={"file": ("roster.csv", head + (
        "Roster,WithId,0799 000 601,CHW,Iringa,2023-01-01,VOTER,T-1000-0799-699\n"), "text/csv")}, expect=201)
    assert refused["error_count"] == 1 and "different ID" in refused["errors"][0]["error"]
