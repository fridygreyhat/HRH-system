import { BudgetLine, Me } from '../../types';

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
