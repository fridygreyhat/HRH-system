import io
import json
import urllib.error
from unittest.mock import MagicMock

import pytest

from backend.services import vodacom_sms
from backend.services.sms_gateway import get_sms_gateway
from backend.core import config


@pytest.fixture
def gateway(monkeypatch):
    monkeypatch.setenv("VODACOM_API_KEY", "test-only-key")
    monkeypatch.setenv("VODACOM_AUTH_TOKEN", "test-only-token")
    monkeypatch.setenv("VODACOM_SENDER_ID", "Tanzania HRH")
    return vodacom_sms.VodacomSMSGateway()


def response(monkeypatch, raw):
    opener = MagicMock()
    opener.open.return_value.__enter__.return_value.read.return_value = raw
    monkeypatch.setattr(vodacom_sms.urllib.request, "build_opener", lambda *args: opener)
    return opener


@pytest.mark.parametrize("raw", [
    b'{"MessageID":"accepted-id","Status":{"StatusCode":0}}',
    b'<SMSSubmitRsp><MessageID>accepted-id</MessageID><Status><StatusCode>0</StatusCode></Status></SMSSubmitRsp>',
])
def test_send_contract(gateway, monkeypatch, raw, caplog):
    opener = response(monkeypatch, raw)
    assert gateway.send_sms("+255712345678", "private OTP 123456", sensitive=True) == "accepted-id"
    request = opener.open.call_args.args[0]
    assert request.full_url == vodacom_sms.SMS_URL
    assert request.get_header("X-auth-key") == "test-only-key"
    assert request.get_header("X-auth-token") == "test-only-token"
    data = json.loads(request.data)
    assert data["address"] == "Tanzania HRH"
    assert data["recipient"] == "255712345678"
    assert data["shortMessage"] == "private OTP 123456"
    assert data["tariffPrice"] == 0
    assert data["referenceId"]
    assert "123456" not in caplog.text


@pytest.mark.parametrize("raw", [
    b'{"MessageID":"rejected","Status":{"StatusCode":1}}',
    b'{"MessageID":"","Status":{"StatusCode":0}}',
    b'{"message":"success"}',
    b'not json',
    b'<html>Login</html>',
    b'<!DOCTYPE x><SMSSubmitRsp/>',
    b"x" * 65537,
])
def test_rejected_or_unknown_response_is_not_success(gateway, monkeypatch, raw):
    response(monkeypatch, raw)
    assert gateway.send_sms("255712345678", "message") is None


def test_network_failure_redacted(gateway, monkeypatch, caplog):
    opener = response(monkeypatch, b"")
    opener.open.side_effect = urllib.error.HTTPError(
        vodacom_sms.SMS_URL, 401, "private OTP 123456 test-only-token", {}, io.BytesIO()
    )
    assert gateway.send_sms("+255712345678", "private OTP 123456", sensitive=True) is None
    assert "123456" not in caplog.text
    assert "test-only-token" not in caplog.text


@pytest.mark.parametrize("phone", ["0712345678", "255712345678,255712345679", "+12345678900", ""])
def test_invalid_recipient_does_not_send(gateway, monkeypatch, phone):
    opener = response(monkeypatch, b"")
    assert gateway.send_sms(phone, "message") is None
    opener.open.assert_not_called()


def test_missing_credentials_does_not_send(gateway, monkeypatch):
    monkeypatch.delenv("VODACOM_AUTH_TOKEN")
    opener = response(monkeypatch, b"")
    assert gateway.send_sms("+255712345678", "message") is None
    opener.open.assert_not_called()


def test_gateway_selection_and_no_mock_fallback(monkeypatch):
    monkeypatch.setattr(config, "SMS_GATEWAY_TYPE", "vodacom")
    assert isinstance(get_sms_gateway(), vodacom_sms.VodacomSMSGateway)
    monkeypatch.setattr(config, "SMS_GATEWAY_TYPE", "typo")
    with pytest.raises(ValueError):
        get_sms_gateway()


def test_redirects_refused():
    assert vodacom_sms._NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com") is None
