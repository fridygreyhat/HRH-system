"""Prepare a data-only foundation and credential-free, reviewed setup import.

Never connects to a database. The owner applies the foundation manually, then
uses the existing Super Admin Setup transfer review/apply flow for saved setup.
"""

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.seed import SECTIONS, ROUTES
from backend.services.setup_transfer_schema import TransferDocument
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Previously exported setup JSON")
    parser.add_argument("--users-only", action="store_true", help="Recover only users and their placement dependencies")
    args = parser.parse_args()
    recover = user_recovery_document if args.users_only else recovery_document
    document = recover(json.loads(args.source.read_text(encoding="utf-8")))
    foundation_name = "user-restore-foundation.sql" if args.users_only else "testing-foundation.sql"
    document_name = "user-setup-restore.json" if args.users_only else "testing-setup-restore.json"
    write_private(ROOT / ".data" / foundation_name, foundation_sql(document))
    write_private(ROOT / ".data" / document_name, document.model_dump_json(indent=2))
    counts = {}
    for record in document.records:
        counts[record.kind] = counts.get(record.kind, 0) + 1
    print(f"Prepared .data/{foundation_name} and .data/{document_name}")
    print("Saved configuration record counts:", counts)
    print("No database modified. No passwords or previous work included.")


if __name__ == "__main__":
    main()
