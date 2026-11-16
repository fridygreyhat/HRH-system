import React, { useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { useApi } from '../../hooks';
import { Cadre, Named, Organization } from '../../types';
import { Alert, Field } from '../../components/ui';

/** Who a new account is for. Each kind is registered with only what that work needs. */
export type AccountType = 'provider' | 'reviewer' | 'technical' | 'manager' | 'finance' | 'admin';

export const ACCOUNT_TYPES: { key: AccountType; title: string; text: string }[] = [
  { key: 'provider', title: 'Provider', text: 'CHW, Data Clerk or HCP who records work. Gives TIN and bank details.' },
  { key: 'reviewer', title: 'Reviewer', text: 'CTC or Facility In-Charge who checks work at a facility; community verifier.' },
  { key: 'technical', title: 'Technical officer', text: 'FHI360 technical officer, or CSO technical officer for community activities.' },
  { key: 'manager', title: 'Regional Manager', text: 'Authorizes timesheets and budgets for a region.' },
  { key: 'finance', title: 'Finance', text: 'Regional Finance, Central Finance (FHI360) or CSO Finance.' },
  { key: 'admin', title: 'Administrator', text: 'Accounts and settings, the staff registry, or read-only oversight.' },
];

interface District extends Named { region_id: number }
interface Ward extends Named { district_id: number }
interface FacilityRow extends Named { ward_id: number }
interface CommunityArea extends Named { district_id: number | null; ward_id: number | null }

/** The choices inside one account type, and the places and cadres picked for it. */
export interface OfficeAccess {
  kind: string;
  regions: number[];
  facilities: number[];
  areas: number[];
  organization: string;
  cadres: number[];
}

export const EMPTY_ACCESS: OfficeAccess = { kind: '', regions: [], facilities: [], areas: [], organization: '', cadres: [] };

interface Kind { key: string; title: string; text: string; roles: string[]; superOnly?: boolean }

/** The roles each choice grants. Matches ROLE_NEEDS in backend/api/endpoints/admin.py. */
export const KINDS: Record<Exclude<AccountType, 'provider'>, Kind[]> = {
  reviewer: [
    { key: 'ctc', title: 'CTC In-Charge', text: 'Verifies that work happened at their facility.', roles: ['SUPERVISOR'] },
    { key: 'facility', title: 'Facility In-Charge', text: 'Endorses work where the cadre form asks for it.', roles: ['FACILITY_IN_CHARGE'] },
    { key: 'both', title: 'CTC and Facility In-Charge', text: 'Both, at the same facility.', roles: ['SUPERVISOR', 'FACILITY_IN_CHARGE'] },
    { key: 'community', title: 'Community verifier', text: 'Verifies community claims in their community areas.', roles: ['COMMUNITY_VERIFIER'] },
  ],
  technical: [
    { key: 'fhi360', title: 'FHI360 technical officer', text: 'Technical review of the cadres in their technical area.', roles: ['TECHNICAL_OFFICER'] },
    { key: 'cso', title: 'CSO technical officer', text: 'First review of community activities by their CSO’s community providers.', roles: ['CSO_TECHNICAL_OFFICER'] },
  ],
  manager: [
    { key: 'rm', title: 'Regional Manager', text: 'Final program and budget authorization for the region.', roles: ['RPM'] },
  ],
  finance: [
    { key: 'regional', title: 'Regional Finance', text: 'Approves timesheets, signs Payroll to the CSO and sends Services to Central Finance.', roles: ['REGIONAL_FINANCE'] },
    { key: 'central', title: 'Central Finance (FHI360)', text: 'Approves and pays Services for every region.', roles: ['FHI360_FINANCE'] },
    { key: 'cso', title: 'CSO Finance', text: 'Pays their CSO’s Payroll from the signed reports.', roles: ['CSO_FINANCE'] },
  ],
  admin: [
    { key: 'system', title: 'System administrator', text: 'Accounts, roles and settings.', roles: ['SYSTEM_ADMIN'] },
    { key: 'central', title: 'Central administrator', text: 'Staff registry and organizations, every region.', roles: ['CENTRAL_ADMIN'] },
    { key: 'regional', title: 'Regional administrator', text: 'Staff and facilities in their regions.', roles: ['REGIONAL_ADMIN'] },
    { key: 'oversight', title: 'FHI360 oversight', text: 'Read-only view across regions.', roles: ['OVERSIGHT'] },
    { key: 'super', title: 'Super administrator', text: 'Every role and page. Only a super administrator can grant this.', roles: ['SUPER_ADMIN'], superOnly: true },
  ],
};

/** What each choice asks for. */
function needs(type: AccountType, kind: string) {
  return {
    facilities: type === 'reviewer' && kind !== 'community',
    areas: type === 'reviewer' && kind === 'community',
    regions: (type === 'technical') || type === 'manager' || (type === 'finance' && kind === 'regional') || (type === 'admin' && kind === 'regional'),
    organization: (type === 'technical' && kind === 'cso') || (type === 'finance' && kind === 'cso'),
    pickCadres: type === 'technical',
    // Finance works on every cadre: Regional Finance signs whole-region reports.
    allCadres: type === 'finance',
  };
}

type Scope = { region_id: number | null; cluster_id: null; facility_id: number | null; community_area_id: number | null; organization_id: number | null };
const scope = (part: Partial<Scope>): Scope => ({ region_id: null, cluster_id: null, facility_id: null, community_area_id: null, organization_id: null, ...part });

/** Roles, scopes and cadres for the request, or a message saying what is missing. */
export function officePayload(type: AccountType, access: OfficeAccess, allCadreIds: number[]):
  { roles: string[]; scopes: Scope[]; review_cadre_ids: number[] } | string {
  if (type === 'provider') return 'Providers are registered with their staff details.';
  const kind = KINDS[type].find((k) => k.key === access.kind) || (KINDS[type].length === 1 ? KINDS[type][0] : undefined);
  if (!kind) return 'Choose which kind of account this is.';
  const need = needs(type, kind.key);
  if (need.facilities && !access.facilities.length) return 'Add the facility (or facilities) this reviewer works at.';
  if (need.areas && !access.areas.length) return 'Choose the community areas this verifier covers.';
  if (need.organization && !access.organization) return 'Choose the CSO.';
  if (need.regions && !access.regions.length) return 'Choose the region (or regions).';
  if (need.pickCadres && !access.cadres.length) return 'Choose the cadres this technical officer reviews.';
  const scopes = [
    ...(need.facilities ? access.facilities.map((id) => scope({ facility_id: id })) : []),
    ...(need.areas ? access.areas.map((id) => scope({ community_area_id: id })) : []),
    ...(need.organization ? [scope({ organization_id: Number(access.organization) })] : []),
    ...(need.regions ? access.regions.map((id) => scope({ region_id: id })) : []),
  ];
  return { roles: kind.roles, scopes, review_cadre_ids: need.pickCadres ? access.cadres : need.allCadres ? allCadreIds : [] };
}

export function AccountTypeCards({ value, onChange, disabled }: { value: AccountType | null; onChange: (t: AccountType) => void; disabled?: boolean }) {
  return (
    <fieldset className="account-types">
      <legend>Who is this account for?</legend>
      <div className="account-type-grid" role="radiogroup">
        {ACCOUNT_TYPES.map((t) => (
          <label key={t.key} className={`account-type${value === t.key ? ' is-selected' : ''}`}>
            <input type="radio" name="account-type" value={t.key} checked={value === t.key} onChange={() => onChange(t.key)} disabled={disabled} />
            <strong>{t.title}</strong>
            <span>{t.text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Checks<T extends { id: number; name: string }>({ legend, items, value, onChange, disabled, empty }: {
  legend: string; items: T[]; value: number[]; onChange: (ids: number[]) => void; disabled?: boolean; empty: string;
}) {
  return (
    <fieldset className="stack">
      <legend>{legend}</legend>
      {!items.length && <p className="muted small">{empty}</p>}
      <div className="check-grid">
        {items.map((item) => (
          <label key={item.id} className="row">
            <input type="checkbox" checked={value.includes(item.id)} disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...value, item.id] : value.filter((x) => x !== item.id))} />
            <span>{item.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Region, then district and ward, then the facility; several facilities can be added. */
function FacilityPicker({ value, onChange, regions, disabled }: { value: number[]; onChange: (ids: number[]) => void; regions: Named[]; disabled?: boolean }) {
  const districts = useApi<District[]>('/admin/districts');
  const wards = useApi<Ward[]>('/admin/wards');
  const facilities = useApi<FacilityRow[]>('/admin/facilities');
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const [ward, setWard] = useState('');
  const names = new Map((facilities.data || []).map((f) => [f.id, f.name]));
  const shownDistricts = (districts.data || []).filter((d) => String(d.region_id) === region);
  const shownWards = (wards.data || []).filter((w) => String(w.district_id) === district);
  const shown = (facilities.data || []).filter((f) => String(f.ward_id) === ward && !value.includes(f.id));
  return (
    <fieldset className="stack">
      <legend>Facilities *</legend>
      <Alert>{districts.error || wards.error || facilities.error}</Alert>
      {value.length > 0 && (
        <ul className="picked-list">
          {value.map((id) => (
            <li key={id}>
              <span>{names.get(id) || `Facility ${id}`}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(value.filter((x) => x !== id))} disabled={disabled}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid-2">
        <Field label="Region">
          <select value={region} onChange={(e) => { setRegion(e.target.value); setDistrict(''); setWard(''); }} disabled={disabled}>
            <option value="">Choose…</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="District">
          <select value={district} onChange={(e) => { setDistrict(e.target.value); setWard(''); }} disabled={disabled || !region}>
            <option value="">Choose…</option>
            {shownDistricts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Ward">
          <select value={ward} onChange={(e) => setWard(e.target.value)} disabled={disabled || !district}>
            <option value="">Choose…</option>
            {shownWards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Facility" hint={ward && !shown.length ? 'No other facility in this ward.' : undefined}>
          <select value="" onChange={(e) => e.target.value && onChange([...value, Number(e.target.value)])} disabled={disabled || !ward}>
            <option value="">{value.length ? 'Add another…' : 'Choose…'}</option>
            {shown.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      </div>
    </fieldset>
  );
}

/** The fields for one office account type: its kind, then only the places and cadres that kind works on. */
export function OfficeAccessFields({ type, value, onChange, disabled }: {
  type: Exclude<AccountType, 'provider'>; value: OfficeAccess; onChange: (v: OfficeAccess) => void; disabled?: boolean;
}) {
  const { hasRole } = useAuth();
  const regions = useApi<Named[]>('/admin/regions');
  const orgs = useApi<Organization[]>('/admin/organizations');
  const cadres = useApi<Cadre[]>('/admin/cadres');
  const areas = useApi<CommunityArea[]>('/admin/community-areas');
  const kinds = KINDS[type].filter((k) => !k.superOnly || hasRole('SUPER_ADMIN'));
  const kind = kinds.find((k) => k.key === value.kind) || (kinds.length === 1 ? kinds[0] : undefined);
  const need = kind ? needs(type, kind.key) : null;
  const csos = useMemo(() => (orgs.data || []).filter((o) => o.type === 'CSO' && o.is_active !== false), [orgs.data]);
  const set = (part: Partial<OfficeAccess>) => onChange({ ...value, ...part });
  return (
    <div className="stack">
      <Alert>{regions.error || orgs.error || cadres.error || areas.error}</Alert>
      {kinds.length > 1 && (
        <fieldset className="stack">
          <legend>Kind *</legend>
          <div className="kind-list" role="radiogroup">
            {kinds.map((k) => (
              <label key={k.key} className={`kind-option${value.kind === k.key ? ' is-selected' : ''}`}>
                <input type="radio" name={`${type}-kind`} checked={value.kind === k.key} disabled={disabled}
                  onChange={() => onChange({ ...EMPTY_ACCESS, kind: k.key })} />
                <span><strong>{k.title}</strong><span className="muted small">{k.text}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {need?.organization && (
        <Field label="CSO *">
          <select value={value.organization} onChange={(e) => set({ organization: e.target.value })} disabled={disabled} required>
            <option value="">Choose…</option>
            {csos.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      )}
      {need?.facilities && <FacilityPicker value={value.facilities} onChange={(facilities) => set({ facilities })} regions={regions.data || []} disabled={disabled} />}
      {need?.areas && (
        <Checks legend="Community areas *" items={areas.data || []} value={value.areas} onChange={(ids) => set({ areas: ids })}
          disabled={disabled} empty="No community areas are registered yet." />
      )}
      {need?.regions && (
        <Checks legend={kind?.key === 'cso' ? 'Regions where the CSO works *' : 'Regions *'} items={regions.data || []} value={value.regions}
          onChange={(ids) => set({ regions: ids })} disabled={disabled} empty="No regions are registered yet." />
      )}
      {need?.pickCadres && (
        <Checks legend="Cadres they review *" items={(cadres.data || []).map((c) => ({ id: c.id, name: c.name }))} value={value.cadres}
          onChange={(ids) => set({ cadres: ids })} disabled={disabled} empty="No cadres are registered yet." />
      )}
      {need?.allCadres && <p className="muted small">Finance works on every cadre (CHW, Data Clerk and HCP).</p>}
      {kind && type === 'admin' && kind.key !== 'regional' && <p className="muted small">Not limited to a region.</p>}
    </div>
  );
}
