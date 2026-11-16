import { EMPTY_ACCESS, KINDS, officePayload } from './AccountTypes';

const ALL = [1, 2, 3];
const scope = (part) => ({ region_id: null, cluster_id: null, facility_id: null, community_area_id: null, organization_id: null, ...part });

test('each office account type grants its own roles with only what that work needs', () => {
  // Reviewer: a facility.
  expect(officePayload('reviewer', { ...EMPTY_ACCESS, kind: 'ctc' }, ALL)).toMatch(/facility/);
  expect(officePayload('reviewer', { ...EMPTY_ACCESS, kind: 'both', facilities: [7] }, ALL))
    .toEqual({ roles: ['SUPERVISOR', 'FACILITY_IN_CHARGE'], scopes: [scope({ facility_id: 7 })], review_cadre_ids: [] });
  // CSO technical officer, for community activities: the CSO, its regions and the cadres reviewed.
  expect(officePayload('technical', { ...EMPTY_ACCESS, kind: 'cso', organization: '2', regions: [11] }, ALL)).toMatch(/cadres/);
  expect(officePayload('technical', { ...EMPTY_ACCESS, kind: 'cso', organization: '2', regions: [11, 22], cadres: [1] }, ALL))
    .toEqual({ roles: ['CSO_TECHNICAL_OFFICER'], scopes: [scope({ organization_id: 2 }), scope({ region_id: 11 }), scope({ region_id: 22 })], review_cadre_ids: [1] });
  // Regional Manager has one kind, chosen without asking.
  expect(officePayload('manager', { ...EMPTY_ACCESS, regions: [11] }, ALL)).toEqual({ roles: ['RPM'], scopes: [scope({ region_id: 11 })], review_cadre_ids: [] });
  // Finance works on every cadre; Central Finance covers every region.
  expect(officePayload('finance', { ...EMPTY_ACCESS, kind: 'central' }, ALL)).toEqual({ roles: ['FHI360_FINANCE'], scopes: [], review_cadre_ids: ALL });
  expect(officePayload('finance', { ...EMPTY_ACCESS, kind: 'cso' }, ALL)).toBe('Choose the CSO.');
  expect(officePayload('finance', { ...EMPTY_ACCESS, kind: 'regional', regions: [11] }, ALL).review_cadre_ids).toEqual(ALL);
  // Admin: a system administrator has no region; a regional one does.
  expect(officePayload('admin', { ...EMPTY_ACCESS, kind: 'system' }, ALL)).toEqual({ roles: ['SYSTEM_ADMIN'], scopes: [], review_cadre_ids: [] });
  expect(officePayload('admin', { ...EMPTY_ACCESS, kind: 'regional' }, ALL)).toMatch(/region/);
  expect(officePayload('admin', EMPTY_ACCESS, ALL)).toMatch(/Choose which kind/);
});

test('every office role can be registered from one of the account types', () => {
  const granted = new Set(Object.values(KINDS).flat().flatMap((kind) => kind.roles));
  for (const role of ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'COMMUNITY_VERIFIER', 'TECHNICAL_OFFICER', 'CSO_TECHNICAL_OFFICER', 'RPM',
    'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'SYSTEM_ADMIN', 'CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'OVERSIGHT', 'SUPER_ADMIN']) {
    expect(granted.has(role)).toBe(true);
  }
});
