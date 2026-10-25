"""Vodacom Tanzania WASP JSON requests and documented JSON/XML acknowledgements."""

import json
import logging
import os
import re
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from typing import Optional

logger = logging.getLogger(__name__)
SMS_URL = "https://bulksms.vodacom.co.tz:9113/api/v1/wasp_sms_request"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward authentication headers to a redirect destination.
        return None


class VodacomSMSGateway:
    def send_sms(self, to: str, body: str, sensitive: bool = False) -> Optional[str]:
        key = os.getenv("VODACOM_API_KEY")
        token = os.getenv("VODACOM_AUTH_TOKEN")
        sender = os.getenv("VODACOM_SENDER_ID")
        if not all((key, token, sender)):
            logger.error("Vodacom SMS configuration is incomplete")
            return None
        phone = to.strip()
        if phone.startswith("+"):
            phone = phone[1:]
        if not re.fullmatch(r"255[67]\d{8}", phone):
            logger.error("Vodacom SMS requires a Tanzanian mobile number in +255 format")
            return None
        payload = {
            "interfaceId": "JX",
            "senderAddressType": 1,
            "address": sender,
            "recipient": phone,
            "shortMessage": body,
            "msgType": 0,
            "tariffPrice": 0,
            "reportEnabled": True,
            "referenceId": str(uuid.uuid4()),
            "paymentRequired": True,
        }
        request = urllib.request.Request(
            SMS_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, application/xml",
                "x-auth-key": key,
                "x-auth-token": token,
            },
            method="POST",
        )
        try:
            with urllib.request.build_opener(_NoRedirect()).open(request, timeout=15) as response:
                raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError("Oversized acknowledgement")
            if raw.lstrip().startswith(b"<"):
                if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                    raise ValueError("Unsafe XML")
                root = ET.fromstring(raw)
                status = root.findtext("Status/StatusCode")
                message_id = root.findtext("MessageID")
            else:
                data = json.loads(raw)
                status = data["Status"]["StatusCode"]
                message_id = data.get("MessageID")
            if str(status) == "0" and isinstance(message_id, str) and message_id.strip():
                return message_id.strip()
            logger.warning("Vodacom did not acknowledge SMS acceptance")
        except Exception:
            # No raw responses, exceptions, phone numbers, credentials or bodies:
            # gateways can echo any of these, including OTPs, on failure.
            logger.error("Vodacom SMS request failed or returned an invalid acknowledgement")
        return None
