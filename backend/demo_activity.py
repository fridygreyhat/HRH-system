"""Populate a fresh demo database with realistic activity, through the public API.

Runs only when SEED_DEMO_DATA=true, EXPOSE_DEV_OTP=true (needed to confirm SMS codes) and no work log exists yet,
so it is safe to run on every `docker compose up`. Creates logs at every approval stage, claims on routes A, B and C,
a Route B handoff with a partial payment, a reconciled community claim and two queue items older than 48 hours.

Run: python -m backend.demo_activity   (API_URL defaults to http://backend:8000)
"""
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, timedelta

from sqlalchemy import text

from .core import config
from .core.timeutil import local_today
from .db.session import SessionLocal
from .seed import DEMO_PASSWORD

log = logging.getLogger("hrh.demo")
API = os.getenv("API_URL", "http://backend:8000").rstrip("/")
_tokens: dict[str, str] = {}


class ApiError(Exception):
    pass


def _request(method: str, path: str, user: str | None = None, body=None, file=None, form=None):
    headers = {}
    data = None
    if user:
        headers["Authorization"] = f"Bearer {_token(user)}"
    if file:
        boundary = uuid.uuid4().hex
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        name, content, ctype = file
        data = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode()
            + content
            + f"\r\n--{boundary}--\r\n".encode()
        )
    elif form is not None:
        data = urllib.parse.urlencode(form).encode()
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    try:
        with urllib.request.urlopen(urllib.request.Request(API + path, data=data, headers=headers, method=method), timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise ApiError(f"{method} {path} as {user}: {e.code} {e.read().decode()[:300]}") from None


def _token(user: str) -> str:
    if user not in _tokens:
        _tokens[user] = _request("POST", "/auth/login", form={"username": user, "password": DEMO_PASSWORD})["access_token"]
    return _tokens[user]


def get(path, user):
    return _request("GET", path, user)


def post(path, user, body=None, **kw):
    return _request("POST", path, user, body if body is not None else {}, **kw)


ENTRY = {
    "chw1": {"hours_worked": 8.5, "evidence_text": "Home visits and tracing in Gangilonga",
             "measures": {"clients_screened_hiv_tb": 6, "ltfu_clients_assigned": 9, "clients_followed_up": 5, "clients_returned_to_care": 1},
             "gps_lat": -7.775, "gps_lon": 35.70},
    "clerk1": {"start_time": "07:30", "end_time": "15:30", "evidence_text": "Registered CTC clients and uploaded dataset",
               "measures": {"ctc_clients_registered": 7, "ctc_visits_updated": 7, "hts_clients_registered": 11, "pharmacy_visits_entered": 6, "ctc_hts_dataset_uploaded": True},
               "gps_lat": -7.7701, "gps_lon": 35.6901},
    "hcp1": {"start_time": "16:00", "end_time": "18:00", "evidence_text": "Index testing session at OPD",
             "measures": {"clients_tested_hiv": 5, "clients_tested_index": 4, "clients_tested_positive_new": 1, "hiv_positive_linked_art": 1, "tb_contacts_traced": 2},
             "gps_lat": -7.7702, "gps_lon": 35.6899},
    "hcp2": {"start_time": "08:00", "end_time": "14:00", "evidence_text": "CTC clinic attendance and testing",
             "measures": {"clients_tested_hiv": 8, "clients_attended_ctc": 20}},
}
STAGES = ["submit", "verify", "otp", "endorse", "authorize"]


def work_log(user: str, period: dict, days) -> dict:
    wl = post("/worklogs", user, {"period_id": period["id"]})
    start = date.fromisoformat(period["start_date"])
    for i in days:
        d = start + timedelta(days=i)
        if d <= local_today() and d <= date.fromisoformat(period["end_date"]):
            wl = _request("PUT", f"/worklogs/{wl['id']}/entries/{d}", user, ENTRY[user])
    return wl


def advance(user: str, wl: dict, until: str) -> dict:
    """Move a log through the pipeline using the demo reviewers, stopping after `until`."""
    lid = wl["id"]
    for stage in STAGES[: STAGES.index(until) + 1]:
        cur = get(f"/worklogs/{lid}", user)
        if stage == "submit":
            post(f"/worklogs/{lid}/actions/submit", user, {"attest": True})
        elif stage == "verify":
            post(f"/worklogs/{lid}/actions/verify", "supervisor1", {"expected_version": cur["version"]})
        elif stage == "otp":
            post(f"/worklogs/{lid}/otp/confirm", user, {"code": cur["dev_otp"]})
        elif stage == "endorse":
            if cur["cadre_code"] == "HCP":
                post(f"/worklogs/{lid}/actions/facility_endorse", "facilityic1", {"comment": "Facility register checked"})
            post(f"/worklogs/{lid}/actions/endorse", "tofficer1")
        elif stage == "authorize":
            post(f"/worklogs/{lid}/actions/authorize", "rpm1")
    return get(f"/worklogs/{lid}", user)


def claim(preparer: str, approver: str, body: dict) -> dict:
    c = post("/claims", preparer, body)
    if c["status"] == "PENDING_COMMUNITY_VERIFICATION":
        c = post(f"/claims/{c['id']}/actions/verify_community", "verifier1")
    c = post(f"/claims/{c['id']}/actions/submit", preparer)
    c = post(f"/claims/{c['id']}/actions/approve", approver)
    return c


def pay(claim_id: int, user: str, partial: bool = False) -> dict:
    c = get(f"/claims/{claim_id}", user)
    amount = round(c["amount"] * 0.6, 2) if partial else c["amount"]
    c = post(f"/claims/{claim_id}/payments", user, {"amount": amount, "payment_reference": f"MP{claim_id:06d}DEMO",
                                                   "payment_date": str(local_today()), "status": "PARTIAL" if partial else "PAID"})
    if c["payment_status"] == "PROOF_REQUIRED":
        _request("POST", f"/claims/{claim_id}/proofs", user, file=("mpesa-receipt.pdf", b"%PDF-1.4 demo proof", "application/pdf"))
        c = post(f"/claims/{claim_id}/actions/confirm_paid", user)
    return c


def run() -> None:
    periods = sorted(get("/admin/pay-periods", "chw1"), key=lambda p: p["start_date"])
    last, current = periods[0], periods[-1]

    approved = {u: advance(u, work_log(u, last, range(0, 20, 2)), "authorize") for u in ("chw1", "clerk1", "hcp1")}
    advance("hcp2", work_log("hcp2", last, range(0, 10, 2)), "submit")       # waiting in Njombe (no supervisor there)
    advance("chw1", work_log("chw1", current, range(0, 6)), "verify")        # waiting for the provider's SMS code
    advance("clerk1", work_log("clerk1", current, range(0, 6)), "submit")    # waiting for CTC verification
    advance("hcp1", work_log("hcp1", current, range(0, 6)), "endorse")       # waiting for RPM authorization

    cats = {c["name"]: c["id"] for c in get("/admin/claim-categories", "fhifin1")}
    cat = {r: next(v for k, v in cats.items() if f"(Route {r})" in k) for r in "ABC"}
    a = claim("fhifin1", "fhifin2", {"work_log_id": approved["chw1"]["id"], "category_id": cat["A"]})
    b = claim("fhifin1", "fhifin2", {"work_log_id": approved["clerk1"]["id"], "category_id": cat["B"]})
    claim("fhifin1", "fhifin2", {"work_log_id": approved["hcp1"]["id"], "category_id": cat["A"]})  # approved, not yet paid
    chw = next(s for s in get("/staff", "csofin1") if s["legal_name"].startswith("Neema"))
    c = claim("csofin1", "csofin2", {"category_id": cat["C"], "staff_id": chw["id"], "period_id": last["id"],
                                     "evidence_text": "Community PrEP outreach sessions in Gangilonga", "declared_units": {"days": 6, "clients_followed_up": 24}})

    post(f"/claims/{a['id']}/actions/mark_ready", "fhifin1")
    post(f"/claims/{b['id']}/actions/mark_ready", "fhifin1")
    post(f"/claims/{c['id']}/actions/mark_ready", "csofin1")
    for route, user in (("A", "fhifin1"), ("B", "fhifin1"), ("C", "csofin1")):
        post("/batches", user, {"route_code": route})
    batch_b = next(bt for bt in get("/batches", "fhifin1") if bt["route_code"] == "B")
    post(f"/batches/{batch_b['id']}/hand-off", "fhifin1")
    post(f"/batches/{batch_b['id']}/receive", "csofin1")

    pay(a["id"], "fhifin1")
    pay(c["id"], "csofin1")
    post(f"/claims/{c['id']}/actions/reconcile", "csofin2", {"comment": "Matched CSO bank statement"})
    pay(b["id"], "csofin1", partial=True)

    with SessionLocal() as db:  # make the 48-hour reminder visible on the dashboard
        db.execute(text("update work_logs set status_changed_at = now() - interval '61 hours' where status = 'PENDING_CTC_VERIFICATION'"))
        db.commit()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    if not config.SEED_DEMO_DATA:
        log.info("SEED_DEMO_DATA is off; nothing to do")
        return
    if not config.EXPOSE_DEV_OTP:
        log.info("EXPOSE_DEV_OTP is off, so demo logs cannot be confirmed by SMS code; skipping")
        return
    with SessionLocal() as db:
        if db.execute(text("select count(*) from work_logs")).scalar():
            log.info("Work logs already exist; demo activity not added")
            return
    for _ in range(30):
        try:
            _request("GET", "/health")
            break
        except Exception:
            time.sleep(2)
    try:
        run()
    except ApiError as e:
        log.error("Demo activity stopped: %s", e)
        sys.exit(1)
    log.info("Demo activity created")


if __name__ == "__main__":
    main()
