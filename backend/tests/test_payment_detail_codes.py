"""A provider's payment details change only with a code sent to the registered phone."""
from datetime import timedelta

import pytest

from backend.models import AuditEvent, PaymentDetailsCode, SMSOutbox, Staff, utcnow
from backend.services import notifications, payment_detail_codes
from .test_provider_payment_details import provider_profile  # noqa: F401

pytestmark = pytest.mark.real_payment_code
NEW = {"mobile_money_number": "+255712300001"}
OTHER = {"mobile_money_number": "+255712300002"}


@pytest.fixture
def staff_id(db, provider_profile):  # noqa: F811
    def clear():
        db.rollback()
        db.query(PaymentDetailsCode).filter_by(staff_id=provider_profile).delete()
        db.commit()
    clear()
    yield provider_profile
    clear()


def send(api, body=NEW, **kw):
    return api.post("/provider-details/me/code", "chw1", body, **kw)


def saved(api):
    return api.get("/provider-details/me", "chw1")["mobile_money_number"]


def allow_resend(db, staff_id):
    db.query(PaymentDetailsCode).filter_by(staff_id=staff_id).update({PaymentDetailsCode.created_at: utcnow() - timedelta(minutes=5)})
    db.commit()


def test_details_are_not_saved_without_a_code(api, staff_id):
    before = saved(api)
    api.put("/provider-details/me", "chw1", NEW, expect=400)
    api.put(f"/provider-details/update-details/{staff_id}", "chw1", NEW, expect=400)
    assert saved(api) == before


def put_back(db, staff_id, number):
    """Details moved on, for example by an approved correction, so replaying the old change would be a real change."""
    db.get(Staff, staff_id).mobile_money_number = number
    db.commit()


def test_the_code_saves_the_change_once_and_only_once(api, db, staff_id):
    before = saved(api)
    code = send(api)["dev_otp"]
    assert len(code) == 6
    api.put("/provider-details/me", "chw1", {**NEW, "code": code})
    assert saved(api) == NEW["mobile_money_number"]
    put_back(db, staff_id, before)
    db.expire_all()
    api.put("/provider-details/me", "chw1", {**NEW, "code": code}, expect=400)
    assert saved(api) == before


def test_a_code_cannot_approve_different_details_from_the_ones_it_was_sent_for(api, staff_id):
    before = saved(api)
    code = send(api)["dev_otp"]
    api.put("/provider-details/me", "chw1", {**OTHER, "code": code}, expect=400)
    assert saved(api) == before


def test_guessing_stops_after_five_tries_even_with_the_right_code(api, staff_id):
    before = saved(api)
    code = send(api)["dev_otp"]
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(payment_detail_codes.MAX_ATTEMPTS):
        api.put("/provider-details/me", "chw1", {**NEW, "code": wrong}, expect=400)
    api.put("/provider-details/me", "chw1", {**NEW, "code": code}, expect=400)
    assert saved(api) == before


def test_a_failed_guess_is_recorded(api, db, staff_id):
    code = send(api)["dev_otp"]
    wrong = "000000" if code != "000000" else "111111"
    api.put("/provider-details/me", "chw1", {**NEW, "code": wrong}, expect=400)
    assert db.query(AuditEvent).filter_by(entity_type="staff", entity_id=str(staff_id), action="payment_details_code_failed").count() >= 1


def test_an_expired_code_is_refused(api, db, staff_id):
    code = send(api)["dev_otp"]
    db.query(PaymentDetailsCode).filter_by(staff_id=staff_id).update({PaymentDetailsCode.expires_at: utcnow() - timedelta(seconds=1)})
    db.commit()
    api.put("/provider-details/me", "chw1", {**NEW, "code": code}, expect=400)


def test_a_new_code_cancels_the_older_one(api, db, staff_id):
    before = saved(api)
    first = send(api)["dev_otp"]
    allow_resend(db, staff_id)
    second = send(api)["dev_otp"]
    api.put("/provider-details/me", "chw1", {**NEW, "code": second})
    put_back(db, staff_id, before)
    db.expire_all()
    if first != second:
        api.put("/provider-details/me", "chw1", {**NEW, "code": first}, expect=400)
        assert saved(api) == before


def test_sending_is_limited_by_the_wait_and_the_daily_cap(api, db, staff_id):
    send(api)
    send(api, expect=429)
    for _ in range(payment_detail_codes.MAX_SENDS_PER_DAY - 1):
        allow_resend(db, staff_id)
        send(api)
    allow_resend(db, staff_id)
    send(api, expect=429)


def test_the_code_goes_to_the_registered_phone_and_is_never_stored_in_clear(api, db, staff_id, monkeypatch):
    calls = []
    gateway = type("Gateway", (), {"send_sms": lambda self, to, body, sensitive=False: calls.append((to, body, sensitive)) or "id"})()
    monkeypatch.setattr(notifications, "get_sms_gateway", lambda: gateway)
    result = send(api)
    phone = db.get(Staff, staff_id).verified_phone
    assert calls == [(phone, calls[0][1], True)]
    assert result["dev_otp"] in calls[0][1]
    assert result["phone"] != phone and phone not in str(result)
    stored = db.query(SMSOutbox).filter_by(event_name="PAYMENT_DETAILS_CODE").order_by(SMSOutbox.id.desc()).first()
    assert result["dev_otp"] not in stored.message_body


def test_when_the_sms_fails_the_provider_is_told_and_nothing_changes(api, staff_id, monkeypatch):
    before = saved(api)
    gateway = type("Gateway", (), {"send_sms": lambda self, to, body, sensitive=False: None})()
    monkeypatch.setattr(notifications, "get_sms_gateway", lambda: gateway)
    send(api, expect=502)
    assert saved(api) == before


def test_saving_the_same_details_sends_no_sms(api, db, staff_id):
    current = api.get("/provider-details/me", "chw1")
    body = {key: current[key] for key in ("bank_name", "bank_account_number", "bank_branch", "mobile_money_number")}
    assert send(api, body) == {"changed": False}
    assert db.query(PaymentDetailsCode).filter_by(staff_id=staff_id).count() == 0
    assert api.put("/provider-details/me", "chw1", body) == current


def test_only_a_provider_can_ask_for_a_code(api, staff_id):
    api.post("/provider-details/me/code", "fhifin1", NEW, expect=403)
