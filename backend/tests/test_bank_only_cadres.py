"""HCP salaries are paid into a bank account only (the bank_only_cadres setting)."""
from datetime import date


def _staff(api, cadre_code: str, phone: str, method: str) -> dict:
    cadre = next(c for c in api.get("/admin/cadres", "admin") if c["code"] == cadre_code)
    region = api.get("/admin/regions", "admin")[0]
    return {
        "cadre_id": cadre["id"], "first_name": "Asha", "last_name": "Komba", "verified_phone": phone,
        "employment_start_date": date.today().isoformat(), "assignment": {"region_id": region["id"]},
        "payment_method": method, "payment_provider": "NMB", "payment_account": "0123456789",
    }


def test_hcp_cannot_be_paid_by_mobile_wallet(api):
    api.post("/staff", "central1", _staff(api, "HCP", "+255700444111", "MOBILE_WALLET"), expect=422)
    hcp = api.post("/staff", "central1", _staff(api, "HCP", "+255700444222", "BANK"), expect=201)
    api.call("PATCH", f"/staff/{hcp['id']}", "central1", {"changes": {"payment_method": "MOBILE_WALLET"}, "reason": "switch"}, expect=422)


def test_chw_may_use_a_mobile_wallet(api):
    api.post("/staff", "central1", _staff(api, "CHW", "+255700444333", "MOBILE_WALLET"), expect=201)
