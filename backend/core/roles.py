PROVIDER = "PROVIDER"
SUPERVISOR = "SUPERVISOR"  # CTC In-Charge / Supervisor
FACILITY_IN_CHARGE = "FACILITY_IN_CHARGE"
TECHNICAL_OFFICER = "TECHNICAL_OFFICER"  # Cluster / Regional Technical Officer
RPM = "RPM"  # Regional Manager (RM); retain the stored role code for compatibility.
REGIONAL_FINANCE = "REGIONAL_FINANCE"
COMMUNITY_VERIFIER = "COMMUNITY_VERIFIER"
FHI360_FINANCE = "FHI360_FINANCE"
CSO_FINANCE = "CSO_FINANCE"
OVERSIGHT = "OVERSIGHT"  # FHI360 oversight / management: read-only cross-region view
CENTRAL_ADMIN = "CENTRAL_ADMIN"
REGIONAL_ADMIN = "REGIONAL_ADMIN"
SYSTEM_ADMIN = "SYSTEM_ADMIN"
SUPER_ADMIN = "SUPER_ADMIN"  # holds every role, with no scope limit

ROLE_DESCRIPTIONS = {
    PROVIDER: "Records own work logs and confirms verified logs by OTP",
    SUPERVISOR: "CTC In-Charge / Supervisor: verifies that work occurred",
    FACILITY_IN_CHARGE: "Supplemental facility endorsement where the cadre form requires it",
    TECHNICAL_OFFICER: "FHI360 technical officer: technical endorsement of the cadres in their technical area",
    RPM: "Regional Manager (RM): final program and budget authorization",
    REGIONAL_FINANCE: "Regional Finance: validates RM-authorized amounts and routes services to FHI360 and payroll to CSO",
    COMMUNITY_VERIFIER: "Verifies community-originated (Route C) claims not based on an HRH work log",
    FHI360_FINANCE: "FHI360 Finance: Route A claims and Route B processing/handoff",
    CSO_FINANCE: "CSO Finance: own organization's Route B payrolls and Route C claims, payments and proof",
    OVERSIGHT: "FHI360 oversight: read-only cross-region and cross-payor status",
    CENTRAL_ADMIN: "Global staff registry and organization configuration",
    REGIONAL_ADMIN: "Staff and facility administration within assigned regions",
    SYSTEM_ADMIN: "Accounts, roles and technical configuration",
    SUPER_ADMIN: "Super administrator: every role and every page, across all regions and organizations",
}
ALL_ROLES = list(ROLE_DESCRIPTIONS)

REVIEWER_ROLES = (SUPERVISOR, FACILITY_IN_CHARGE, TECHNICAL_OFFICER, RPM, REGIONAL_FINANCE)
FINANCE_ROLES = (FHI360_FINANCE, CSO_FINANCE)
ADMIN_ROLES = (CENTRAL_ADMIN, REGIONAL_ADMIN, SYSTEM_ADMIN, SUPER_ADMIN)
