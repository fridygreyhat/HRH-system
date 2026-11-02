"""Prepare a data-only foundation and credential-free, reviewed setup import.

Never connects to a database. The owner applies the foundation manually, then
uses the existing Super Admin Setup transfer review/apply flow for saved setup.
"""

import argparse
import copy
import csv
import json
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.seed import SECTIONS, ROUTES
from backend.services.setup_transfer_schema import TransferDocument, normalize_tanzanian_phone
from scripts.prepare_activity_restore import build_sql as activity_sql
from scripts.prepare_production_admin import literal, write_private


def recovery_document(source):
    original = TransferDocument.model_validate(source)
    result = original.model_dump(mode="json")
    result["records"] = [record for record in result["records"] if record["kind"] != "pay_period"]
    result["warnings"] = [
        "Recovery excludes all old pay periods and submitted work, approvals and payments.",
        "Imported accounts are inactive and require activation and a password reset in Users.",
        "Existing records and credentials are never overwritten. Review conflicts before applying.",
        "CSO payment authority is not included; configure it explicitly after review.",
    ]
    return TransferDocument.model_validate(result)


def user_recovery_document(source):
    """Recover operational users and their placement dependencies, never work."""
    source = copy.deepcopy(source)
    for record in source.get("records", []):
        if record.get("kind") != "user_setup":
            continue
        phone = record.get("data", {}).get("phone", "")
        record["data"]["phone"] = normalize_tanzanian_phone(phone)
    result = recovery_document(source).model_dump(mode="json")
    result["records"] = [
        record for record in result["records"]
        if record["kind"] in {"user_setup", "organization", "facility"}
    ]
    if not any(record["kind"] == "user_setup" for record in result["records"]):
        raise ValueError("The saved setup contains no recoverable operational users.")
    result["warnings"] = [
        "User setup and dependent organizations/facilities only; no previous work or approvals.",
        "No pay periods, funding sources, service rates, claims, payments or credentials.",
        "Imported accounts are inactive; activate and reset passwords in Users before sign-in.",
        "Existing accounts, credentials and setup are never overwritten.",
        "CSO payment authority must be configured separately after review.",
    ]
    return TransferDocument.model_validate(result)


def reconcile_live_user(document, username, live_user):
    """Merge an explicitly approved saved identity onto its matching Live login."""
    candidates = [row for row in document.records if row.kind == "user_setup"
                  and row.data["username"] == username]
    if len(candidates) != 1:
        raise ValueError(f"Saved user is missing or ambiguous: {username}")
    saved = candidates[0].data
    if "username" not in live_user or "phone" not in live_user or "full_name" not in live_user:
        raise ValueError("The selected Live account identity is incomplete")
    if " ".join(saved["full_name"].split()).casefold() != " ".join(
        live_user["full_name"].split()
    ).casefold():
        raise ValueError("The saved and Live full names differ; review the identity manually")
    if live_user.get("has_staff") and not saved["staff"]:
        raise ValueError("The Live account has a staff record absent from saved setup")
    roles = set(live_user.get("roles") or [])
    if not roles <= {"PROVIDER", "SUPERVISOR", "FACILITY_IN_CHARGE", "TECHNICAL_OFFICER",
                     "RPM", "REGIONAL_FINANCE", "COMMUNITY_VERIFIER", "FHI360_FINANCE",
                     "CSO_FINANCE", "OVERSIGHT"}:
        raise ValueError("The selected Live account has non-transferable roles")
    saved["username"] = live_user["username"]
    saved["full_name"] = live_user["full_name"]
    saved["phone"] = normalize_tanzanian_phone(live_user["phone"])
    saved["roles"] = sorted(set(saved["roles"]) | roles)
    saved["review_cadres"] = sorted(set(saved["review_cadres"]) | set(
        live_user.get("review_cadres") or []
    ))
    return document


def reconcile_live_facility(document, saved_name, live_facility):
    """Point one explicitly approved saved facility at its current Live location."""
    matches = [row for row in document.records if row.kind == "facility"
               and row.data["name"].casefold() == saved_name.casefold()]
    required = {"name", "region", "district", "ward", "facility_type"}
    if len(matches) != 1 or not required <= live_facility.keys():
        raise ValueError("Saved or Live facility is missing or ambiguous")
    source = matches[0].data
    old_ref = {key: source[key] for key in ("name", "region", "district", "ward")}
    new_ref = {key: live_facility[key] for key in ("name", "region", "district", "ward")}
    for key, value in new_ref.items():
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Live facility location is incomplete")

    def visit(value):
        if isinstance(value, dict):
            ref = value.get("facility")
            if isinstance(ref, dict) and all(ref.get(key) == old_ref[key] for key in old_ref):
                value["facility"] = {**ref, **new_ref}
                for key in ("region", "district", "ward"):
                    if key in value:
                        value[key] = new_ref[key]
            if all(value.get(key) == old_ref[key] for key in old_ref):
                value.update(new_ref)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(matches[0].data)
    source["facility_type"] = live_facility["facility_type"]
    for key in ("geofence_lat", "geofence_lon", "geofence_radius_meters"):
        source[key] = live_facility.get(key)
    for record in document.records:
        if record.kind == "user_setup":
            visit(record.data)
    return document


def geography(document):
    regions, districts, wards = set(), set(), set()

    def visit(value):
        if isinstance(value, dict):
            region, district, ward = (value.get(key) for key in ("region", "district", "ward"))
            if isinstance(region, str):
                regions.add(region)
                if isinstance(district, str):
                    districts.add((region, district))
                    if isinstance(ward, str):
                        wards.add((region, district, ward))
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(document.model_dump(mode="json"))
    return sorted(regions), sorted(districts), sorted(wards)


def foundation_sql(document):
    regions, districts, wards = geography(document)
    statements = []
    for region in regions:
        statements.append(
            "INSERT INTO public.regions(name, created_at) "
            f"SELECT {literal(region)}, CURRENT_TIMESTAMP "
            f"WHERE NOT EXISTS (SELECT 1 FROM public.regions WHERE lower(name)=lower({literal(region)}));"
        )
    for region, district in districts:
        statements.append(
            "INSERT INTO public.districts(region_id, name, created_at) "
            f"SELECT r.id, {literal(district)}, CURRENT_TIMESTAMP FROM public.regions r "
            f"WHERE lower(r.name)=lower({literal(region)}) AND NOT EXISTS "
            f"(SELECT 1 FROM public.districts d WHERE d.region_id=r.id AND lower(d.name)=lower({literal(district)}));"
        )
    for region, district, ward in wards:
        statements.append(
            "INSERT INTO public.wards(district_id, name, created_at) "
            f"SELECT d.id, {literal(ward)}, CURRENT_TIMESTAMP FROM public.districts d "
            "JOIN public.regions r ON r.id=d.region_id "
            f"WHERE lower(r.name)=lower({literal(region)}) AND lower(d.name)=lower({literal(district)}) "
            f"AND NOT EXISTS (SELECT 1 FROM public.wards w WHERE w.district_id=d.id AND lower(w.name)=lower({literal(ward)}));"
        )
    for code, name in SECTIONS:
        statements.append(
            f"INSERT INTO public.sections(code,name) VALUES ({literal(code)}, {literal(name)}) "
            "ON CONFLICT (code) DO NOTHING;"
        )
    for code, name, description in ROUTES:
        statements.append(
            "INSERT INTO public.payment_routes(code,name,description) VALUES "
            f"({literal(code)}, {literal(name)}, {literal(description)}) "
            "ON CONFLICT (code) DO NOTHING;"
        )
    body = activity_sql().split("DO $activity_restore$\n", 1)[1].rsplit("$activity_restore$;", 1)[0]
    return (
        "-- ONE atomic statement. Missing foundation only; no accounts, work or schema changes.\n"
        "DO $testing_foundation$\nBEGIN\n"
        "PERFORM set_config('lock_timeout', '8s', true);\n"
        "LOCK TABLE public.regions, public.districts, public.wards, public.sections, "
        "public.payment_routes IN SHARE ROW EXCLUSIVE MODE;\n"
        + body + "\n" + "\n".join(statements) +
        "\nRAISE NOTICE 'Foundation restored. Now review and apply the saved JSON in Super Admin Setup transfer.';\n"
        "END;\n$testing_foundation$;\n"
    )


def user_foundation_sql(document):
    """Simple, repeatable DML for only the location and section prerequisites."""
    regions, districts, wards = geography(document)
    statements = []
    for location in regions:
        value = literal(location)
        statements.append(
            "INSERT INTO public.regions(name, created_at) "
            f"SELECT {value}, CURRENT_TIMESTAMP WHERE NOT EXISTS "
            f"(SELECT 1 FROM public.regions WHERE lower(name)=lower({value}));"
        )
    for region, district in districts:
        r, d = literal(region), literal(district)
        statements.append(
            "INSERT INTO public.districts(region_id, name, created_at) "
            f"SELECT r.id, {d}, CURRENT_TIMESTAMP FROM public.regions r "
            f"WHERE lower(r.name)=lower({r}) AND NOT EXISTS "
            f"(SELECT 1 FROM public.districts x WHERE x.region_id=r.id AND lower(x.name)=lower({d}));"
        )
    for region, district, ward in wards:
        r, d, w = map(literal, (region, district, ward))
        statements.append(
            "INSERT INTO public.wards(district_id, name, created_at) "
            "SELECT d.id, " + w + ", CURRENT_TIMESTAMP FROM public.districts d "
            "JOIN public.regions r ON r.id=d.region_id "
            f"WHERE lower(r.name)=lower({r}) AND lower(d.name)=lower({d}) AND NOT EXISTS "
            f"(SELECT 1 FROM public.wards x WHERE x.district_id=d.id AND lower(x.name)=lower({w}));"
        )
    sections = {code: name for code, name in SECTIONS}
    required_sections = {
        a["section"]
        for record in document.records if record.kind == "user_setup" and record.data["staff"]
        for a in record.data["staff"]["assignments"] if a["section"]
    }
    unknown = required_sections - sections.keys()
    if unknown:
        raise ValueError("Saved setup uses unknown staff sections: " + ", ".join(sorted(unknown)))
    for code in sorted(required_sections):
        statements.append(
            f"INSERT INTO public.sections(code,name) VALUES ({literal(code)}, {literal(sections[code])}) "
            "ON CONFLICT (code) DO NOTHING;"
        )
    return (
        "-- Run the selected plain INSERT statements in this file as one console batch.\n"
        "-- Missing-only location and section prerequisites; no users or work records.\n"
        + "\n".join(statements) + "\n"
    )


def load_live_snapshot(path):
    """Read the single-column CSV result returned by Replit's SQL console API."""
    with path.open(encoding="utf-8", newline="") as source:
        reader = csv.DictReader(source)
        row = next(reader, None)
        if not row or len(row) != 1:
            raise ValueError("Live comparison snapshot is empty or has an unexpected format")
        payload = next(iter(row.values()))
    try:
        snapshot = json.loads(payload)
    except json.JSONDecodeError:
        snapshot = json.loads(__import__("base64").b64decode(payload).decode("utf-8"))
    if not isinstance(snapshot, dict):
        raise ValueError("Live comparison snapshot must contain a JSON object")
    regions = {row["id"]: row["name"] for row in snapshot.get("regions", [])}
    districts = {row["id"]: row for row in snapshot.get("districts", [])}
    wards = {row["id"]: row for row in snapshot.get("wards", [])}
    role_names = {row["id"]: row["name"] for row in snapshot.get("roles", [])}
    cadre_codes = {row["id"]: row["code"] for row in snapshot.get("cadres", [])}
    roles_by_user = {}
    for row in snapshot.get("user_roles", []):
        roles_by_user.setdefault(row["user_id"], []).append(role_names[row["role_id"]])
    review_cadres_by_user = {}
    for row in snapshot.get("user_review_cadres", []):
        review_cadres_by_user.setdefault(row["user_id"], []).append(cadre_codes[row["cadre_id"]])
    staff_user_ids = {row["user_id"] for row in snapshot.get("staff", [])}
    for user in snapshot.get("users", []):
        user["roles"] = sorted(roles_by_user.get(user["id"], []))
        user["review_cadres"] = sorted(review_cadres_by_user.get(user["id"], []))
        user["has_staff"] = user["id"] in staff_user_ids
    for facility in snapshot.get("facilities", []):
        ward = wards.get(facility.get("ward_id"))
        district = districts.get(ward.get("district_id")) if ward else None
        if district:
            facility.update(
                ward=ward["name"], district=district["name"],
                region=regions.get(district.get("region_id")),
            )
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Previously exported setup JSON")
    parser.add_argument("--users-only", action="store_true", help="Recover only users and their placement dependencies")
    parser.add_argument("--live-snapshot", type=Path, help="Private JSON snapshot (CSV base64 output from the read-only Live comparison)")
    parser.add_argument("--match-live-user", help="Approved saved_username=Live_username identity match")
    parser.add_argument("--match-live-facility", help="Approved saved facility name=Live facility name match")
    args = parser.parse_args()
    recover = user_recovery_document if args.users_only else recovery_document
    document = recover(json.loads(args.source.read_text(encoding="utf-8")))
    foundation_name = "user-restore-foundation.sql" if args.users_only else "testing-foundation.sql"
    document_name = "user-setup-restore.json" if args.users_only else "testing-setup-restore.json"
    snapshot = None
    if args.live_snapshot:
        snapshot = load_live_snapshot(args.live_snapshot)
    if args.match_live_user:
        if snapshot is None or "=" not in args.match_live_user:
            raise ValueError("--match-live-user requires --live-snapshot and saved=Live usernames")
        saved_username, live_username = args.match_live_user.split("=", 1)
        live_users = [row for row in snapshot.get("users", []) if row["username"] == live_username]
        if len(live_users) != 1:
            raise ValueError("The selected Live username is missing or ambiguous")
        reconcile_live_user(document, saved_username, live_users[0])
    if args.match_live_facility:
        if snapshot is None or "=" not in args.match_live_facility:
            raise ValueError("--match-live-facility requires --live-snapshot and saved=Live facility names")
        saved_name, live_name = args.match_live_facility.split("=", 1)
        live_facilities = [row for row in snapshot.get("facilities", [])
                           if row["name"].casefold() == live_name.casefold()]
        if len(live_facilities) != 1:
            raise ValueError("The selected Live facility is missing or ambiguous")
        reconcile_live_facility(document, saved_name, live_facilities[0])
    foundation = user_foundation_sql(document) if args.users_only else foundation_sql(document)
    write_private(ROOT / ".data" / foundation_name, foundation)
    write_private(ROOT / ".data" / document_name, document.model_dump_json(indent=2))
    counts = {}
    for record in document.records:
        counts[record.kind] = counts.get(record.kind, 0) + 1
    print(f"Prepared .data/{foundation_name} and .data/{document_name}")
    print("Saved configuration record counts:", counts)
    print("No database modified. No passwords or previous work included.")


if __name__ == "__main__":
    main()
