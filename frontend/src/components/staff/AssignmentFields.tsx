import React from 'react';
import { useAuth } from '../../AuthContext';
import { useApi } from '../../hooks';
import { Assignment, Named, Organization, Section } from '../../types';
import { Alert, Field } from '../ui';

interface District extends Named {
  region_id: number;
}
interface Ward extends Named {
  district_id: number;
}
interface CommunityArea extends Named {
  district_id: number | null;
  ward_id: number | null;
}

export interface AssignmentValue {
  region_id: string;
  district_id: string;
  ward_id: string;
  /** Typed by hand; the server reuses the ward's facility with the same name or registers it. */
  facility_name: string;
  community_area_id: string;
  section: string;
  organization_id: string;
}

export interface AssignmentPayload {
  region_id: number;
  district_id: number | null;
  ward_id: number | null;
  facility_name: string | null;
  community_area_id: number | null;
  section: string | null;
  organization_id: number | null;
}

export const EMPTY_ASSIGNMENT: AssignmentValue = {
  region_id: '',
  district_id: '',
  ward_id: '',
  facility_name: '',
  community_area_id: '',
  section: '',
  organization_id: '',
};

const idOrNull = (v: string): number | null => (v ? Number(v) : null);
const text = (v: number | string | null | undefined): string => (v === null || v === undefined ? '' : String(v));

/** Form value starting from an existing placement (used to pre-fill a rotation). */
export function assignmentValueFrom(a: Assignment | null | undefined): AssignmentValue {
  if (!a) return EMPTY_ASSIGNMENT;
  return {
    region_id: text(a.region_id),
    district_id: text(a.district_id),
    ward_id: text(a.ward_id),
    facility_name: text(a.facility),
    community_area_id: text(a.community_area_id),
    section: text(a.section),
    organization_id: text(a.organization_id),
  };
}

export function assignmentPayload(v: AssignmentValue): AssignmentPayload {
  return {
    region_id: Number(v.region_id),
    district_id: idOrNull(v.district_id),
    ward_id: idOrNull(v.ward_id),
    facility_name: v.facility_name.trim() || null,
    community_area_id: idOrNull(v.community_area_id),
    section: v.section || null,
    organization_id: idOrNull(v.organization_id),
  };
}

/**
 * Cascading region → district → ward pickers, a typed facility name, community area, section and implementing organization.
 * Regional administrators only see the regions in their scope.
 */
export function AssignmentFields({ value, onChange, showSection = true }: { value: AssignmentValue; onChange: (v: AssignmentValue) => void; showSection?: boolean }) {
  const { me, hasRole } = useAuth();
  const regions = useApi<Named[]>('/admin/regions');
  const districts = useApi<District[]>('/admin/districts');
  const wards = useApi<Ward[]>('/admin/wards');
  const areas = useApi<CommunityArea[]>('/admin/community-areas');
  const sections = useApi<Section[]>('/admin/sections');
  const orgs = useApi<Organization[]>('/admin/organizations');

  const regionScope = hasRole('CENTRAL_ADMIN') || hasRole('SYSTEM_ADMIN') ? null : new Set((me?.scopes || []).map((s) => s.region_id).filter((id): id is number => id !== null));
  const regionList = (regions.data || []).filter((r) => !regionScope || regionScope.has(r.id));
  const districtList = (districts.data || []).filter((d) => String(d.region_id) === value.region_id);
  const wardList = (wards.data || []).filter((w) => String(w.district_id) === value.district_id);
  const areaList = (areas.data || []).filter(
    (a) => (value.ward_id && String(a.ward_id) === value.ward_id) || (!value.ward_id && value.district_id && String(a.district_id) === value.district_id),
  );
  const loadError = [regions, districts, wards, areas, sections, orgs].map((r) => r.error).find(Boolean);

  const set = (patch: Partial<AssignmentValue>) => onChange({ ...value, ...patch });

  return (
    <div className="stack">
      <Alert>{loadError && `Could not load location lists: ${loadError}`}</Alert>
      <div className="grid-2">
        <Field label="Region (required)">
          <select
            value={value.region_id}
            onChange={(e) => set({ region_id: e.target.value, district_id: '', ward_id: '', facility_name: '', community_area_id: '' })}
            required
          >
            <option value="">Select…</option>
            {regionList.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="District">
          <select
            value={value.district_id}
            onChange={(e) => set({ district_id: e.target.value, ward_id: '', facility_name: '', community_area_id: '' })}
            disabled={!value.region_id}
          >
            <option value="">—</option>
            {districtList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ward">
          <select value={value.ward_id} onChange={(e) => set({ ward_id: e.target.value, facility_name: '', community_area_id: '' })} disabled={!value.district_id}>
            <option value="">—</option>
            {wardList.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Facility name" hint={value.ward_id ? 'Type the full name, e.g. Mbezi Health Centre.' : 'Choose the ward first.'}>
          <input
            value={value.facility_name}
            onChange={(e) => set({ facility_name: e.target.value })}
            disabled={!value.ward_id}
            maxLength={255}
            autoComplete="off"
            placeholder={value.ward_id ? 'e.g. Mbezi Health Centre' : ''}
          />
        </Field>
        <Field label="Community area" hint="For community-based cadres.">
          <select value={value.community_area_id} onChange={(e) => set({ community_area_id: e.target.value })} disabled={!value.district_id}>
            <option value="">—</option>
            {areaList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        {showSection && (
          <Field label="Section">
            <select value={value.section} onChange={(e) => set({ section: e.target.value })}>
              <option value="">—</option>
              {(sections.data || []).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Implementing organization">
          <select value={value.organization_id} onChange={(e) => set({ organization_id: e.target.value })}>
            <option value="">—</option>
            {(orgs.data || [])
              .filter((o) => o.is_active)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
    </div>
  );
}
