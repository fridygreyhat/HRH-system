import abc
import base64
import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Optional

from ..core import config

logger = logging.getLogger(__name__)


class SMSGateway(abc.ABC):
    @abc.abstractmethod
    def send_sms(self, to: str, body: str, sensitive: bool = False) -> Optional[str]:
        """Sends an SMS and returns a message ID or None on failure. Sensitive bodies are never logged."""


class MockSMSGateway(SMSGateway):
    def send_sms(self, to: str, body: str, sensitive: bool = False) -> Optional[str]:
        logger.info(f"[MOCK SMS] to {to}: {'[protected message]' if sensitive else body}")
        return "mock-msg-id"


class TwilioSMSGateway(SMSGateway):
    def __init__(self):
        self.account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        self.auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        self.from_number = os.getenv("TWILIO_FROM_NUMBER")

    def send_sms(self, to: str, body: str, sensitive: bool = False) -> Optional[str]:
        if not all([self.account_sid, self.auth_token, self.from_number]):
            logger.error("Twilio credentials missing")
            return None

        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Messages.json"
        data = urllib.parse.urlencode({"To": to, "From": self.from_number, "Body": body}).encode()
        auth = base64.b64encode(f"{self.account_sid}:{self.auth_token}".encode()).decode()
        request = urllib.request.Request(url, data=data, headers={"Authorization": f"Basic {auth}"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read())["sid"]
        except Exception:
            logger.exception(f"Twilio send to {to} failed")
            return None


def get_sms_gateway() -> SMSGateway:
    if config.SMS_GATEWAY_TYPE == "twilio":
        return TwilioSMSGateway()
    if config.SMS_GATEWAY_TYPE == "vodacom":
        from .vodacom_sms import VodacomSMSGateway

        return VodacomSMSGateway()
    if config.SMS_GATEWAY_TYPE == "mock":
        return MockSMSGateway()
    raise ValueError("Unsupported SMS_GATEWAY_TYPE; use mock, twilio or vodacom")
