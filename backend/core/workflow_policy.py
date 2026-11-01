"""New records use v2.2; the stored version, never the current default, governs existing records."""
NEW_RECORD_WORKFLOW_VERSION = 2
WORK_TYPES = ("SERVICES", "PAYROLL")
RM_AUTHORIZED_STATUSES = frozenset({
    "APPROVED", "PENDING_FINANCE_REVIEW", "FINANCE_REVIEWED",
    "ROUTED_FHI360", "ROUTED_CSO", "PAID", "BUDGET_HOLD",
})
