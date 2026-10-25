"""Channel-specific payment details. Never serialize a full Staff record to finance."""
from ..core.roles import CSO_FINANCE, FHI360_FINANCE
from ..models import PaymentClaim, Staff
from .scope import claim_visibility

FIELDS = ("bank_name", "bank_account_number", "bank_branch", "mobile_money_number")
LEGACY_FIELDS = ("payment_method", "payment_provider", "payment_account")


def details(staff: Staff) -> dict:
    # Preserve historical payment configuration without inventing bank branches.
    legacy = staff.payment_details_updated_at is None
    return {
        "bank_name": staff.bank_name or (staff.payment_provider if legacy and staff.payment_method == "BANK" else None),
        "bank_account_number": staff.bank_account_number or (staff.payment_account if legacy and staff.payment_method == "BANK" else None),
        "bank_branch": staff.bank_branch,
        "mobile_money_number": staff.mobile_money_number or (staff.payment_account if legacy and staff.payment_method == "MOBILE_WALLET" else None),
    }


def channel_for_claim(claim: PaymentClaim, staff: Staff) -> str:
    if claim.work_type == "PAYROLL" or (claim.workflow_version == 1 and claim.route_code == "B"):
        return "BANK"
    if claim.work_type == "SERVICES" or claim.route_code == "A":
        return "MOBILE_WALLET"
    # Community payments retain their configured payment method.
    return staff.payment_method or ("MOBILE_WALLET" if staff.mobile_money_number else "BANK")


def recipient(staff: Staff, claim: PaymentClaim) -> dict:
    value = details(staff)
    channel = channel_for_claim(claim, staff)
    return {
        "name": staff.legal_name,
        "payment_method": channel,
        "payment_provider": value["bank_name"] if channel == "BANK" else (
            staff.payment_provider if staff.payment_method == "MOBILE_WALLET" else "Mobile money"
        ),
        "payment_account": value["bank_account_number"] if channel == "BANK" else value["mobile_money_number"],
        "bank_branch": value["bank_branch"] if channel == "BANK" else None,
    }


def visible_details(db, current, staff: Staff) -> dict:
    if current.staff_id == staff.id:
        return {"staff_id": staff.id, **details(staff)}
    bank, mobile = False, False
    if current.has_any(CSO_FINANCE, FHI360_FINANCE):
        from .batches import finance_claim_condition
        claims = db.query(PaymentClaim).filter(
            PaymentClaim.staff_id == staff.id, claim_visibility(current), finance_claim_condition(current),
            PaymentClaim.status.notin_(("DRAFT", "VALIDATION_NEEDED", "PENDING_COMMUNITY_VERIFICATION")),
        ).all()
        for claim in claims:
            if FHI360_FINANCE in current.roles and (
                claim.work_type == "SERVICES" or (claim.workflow_version == 1 and claim.route_code == "A")
            ):
                mobile = True
            if CSO_FINANCE in current.roles and claim.executor_org_id in current.scope_values("organization_id"):
                if claim.work_type == "PAYROLL" or (claim.workflow_version == 1 and claim.route_code == "B"):
                    bank = True
                elif claim.work_type == "COMMUNITY" or claim.route_code == "C":
                    if channel_for_claim(claim, staff) == "BANK":
                        bank = True
                    else:
                        mobile = True
    value = details(staff)
    return {
        "staff_id": staff.id,
        **({key: value[key] for key in FIELDS[:3]} if bank else {}),
        **({"mobile_money_number": value["mobile_money_number"]} if mobile else {}),
    }


def redacted_batch_lines(current, batch, lines: list[dict]) -> list[dict]:
    """Return copies; a role-specific download must not mutate immutable snapshots."""
    cso = CSO_FINANCE in current.roles and batch.executor_org_id in current.scope_values("organization_id")
    fhi = FHI360_FINANCE in current.roles
    result = []
    for line in lines:
        copy = dict(line)
        channel = line.get("payment_method")
        allowed = ((channel == "BANK" and cso and batch.route_code in ("B", "C")) or
                   (channel == "MOBILE_WALLET" and
                    ((fhi and batch.route_code == "A") or (cso and batch.route_code == "C"))))
        if not allowed:
            for field in ("payment_provider", "payment_account", "bank_name", "bank_account_number", "bank_branch", "mobile_money_number"):
                if field in copy:
                    copy[field] = ""
        result.append(copy)
    return result
