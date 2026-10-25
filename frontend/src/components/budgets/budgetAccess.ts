import { BudgetLine, Me, Organization } from '../../types';

/** Organization ids the user holds a scope for (CSO finance budget ownership). */
export function scopedOrgIds(me: Me | null): Set<number> {
  const ids = new Set<number>();
  me?.scopes.forEach((s) => {
    if (s.organization_id !== null) ids.add(s.organization_id);
  });
  me?.organizations.forEach((o) => ids.add(o.id));
  return ids;
}

export function scopedRegionIds(me: Me | null): Set<number> {
  const ids = new Set<number>();
  me?.scopes.forEach((s) => {
    if (s.region_id !== null) ids.add(s.region_id);
  });
  return ids;
}

/**
 * Mirrors the server's reallocation check: finance manages its own organization's lines,
 * an RPM may reallocate lines in their region. The server remains the authority.
 */
export function canReallocateFrom(me: Me | null, line: BudgetLine, fhiOrgIds: Set<number>): boolean {
  if (!me) return false;
  const roles = me.roles;
  if (fhiOrgIds.has(line.organization_id)) {
    if (roles.includes('FHI360_FINANCE')) return true;
  } else if (roles.includes('CSO_FINANCE') && scopedOrgIds(me).has(line.organization_id)) {
    return true;
  }
  return roles.includes('RPM') && line.region_id !== null && scopedRegionIds(me).has(line.region_id);
}

/** Only finance roles can manage hard caps and estimates; RPM/oversight remain read-only. */
export function canManageBudgetLine(
  me: Me | null,
  line: BudgetLine,
  activeOrganizations: Organization[],
  activeAssignments: { organization_id: number; region_id: number; is_active: boolean }[] = [],
): boolean {
  if (!me) return false;
  const organization = activeOrganizations.find((org) => org.id === line.organization_id && org.is_active);
  if (!organization) return false;
  if (organization.type === 'FHI360') return me.roles.includes('FHI360_FINANCE');
  return organization.type === 'CSO' && line.region_id != null &&
    activeAssignments.some((assignment) => assignment.organization_id === organization.id && assignment.region_id === line.region_id && assignment.is_active) && (
    me.roles.includes('FHI360_FINANCE') ||
    (me.roles.includes('CSO_FINANCE') && scopedOrgIds(me).has(organization.id))
  );
}

/** Organizations a finance user may create budgets for, limited to active entities. */
export function creatableBudgetOrganizations(
  me: Me | null,
  organizations: Organization[],
): Organization[] {
  if (!me) return [];
  const centralFinance = me.roles.includes('FHI360_FINANCE');
  const csoFinance = me.roles.includes('CSO_FINANCE');
  const mine = scopedOrgIds(me);
  return organizations.filter((organization) =>
    organization.is_active &&
    ((centralFinance && (organization.type === 'FHI360' || organization.type === 'CSO')) ||
      (csoFinance && organization.type === 'CSO' && mine.has(organization.id))),
  );
}
