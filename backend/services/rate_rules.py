"""Compatibility for rates saved before rate approval was removed."""
from ..core.serialize import to_dict

# Publish does not copy development data. Treat an existing Live proposal as
# usable under the new policy without requiring a separate production data fix.
USABLE_RATE_STATUSES = ("ACTIVE", "PENDING_APPROVAL")


def rate_rule_out(rule, **kwargs):
    data = to_dict(rule, **kwargs)
    if data["status"] == "PENDING_APPROVAL":
        data["status"] = "ACTIVE"
    elif data["status"] == "REJECTED":
        data["status"] = "RETIRED"
    return data
