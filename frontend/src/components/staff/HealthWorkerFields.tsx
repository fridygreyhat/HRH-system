import React from 'react';
import { useApi } from '../../hooks';
import { todayLocal } from '../../format';
import { Cadre } from '../../types';
import { Alert, Field, Tabs } from '../ui';
import { AssignmentFields, AssignmentPayload, AssignmentValue, EMPTY_ASSIGNMENT, assignmentPayload } from './AssignmentFields';
import { OccupationFields } from './StaffForms';

/** Active staff record that has no login yet (GET /admin/unlinked-staff). */
export interface UnlinkedStaff {
  id: number;
  legal_name: string;
  cadre: string | null;
  phone: string;
}

export interface HealthWorkerValue {
  mode: 'new' | 'existing';
  staff_id: string;
  cadre_id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  occupation: string;
  occupation_other: string;
  employment_start_date: string;
  assignment: AssignmentValue;
}

export type HealthWorkerPayload =
  | { staff_id: number; staff: null }
  | {
      staff_id: null;
      staff: {
        cadre_id: number;
        first_name: string;
        middle_name: string | null;
        last_name: string;
        verified_phone: string;
        occupation: string | null;
        occupation_other: string | null;
        employment_start_date: string;
        enrollment_source: 'MANUAL';
        assignment: AssignmentPayload;
      };
    };

export const emptyHealthWorker = (): HealthWorkerValue => ({
  mode: 'new',
  staff_id: '',
  cadre_id: '',
  first_name: '',
  middle_name: '',
  last_name: '',
  occupation: '',
  occupation_other: '',
  employment_start_date: todayLocal(),
  assignment: EMPTY_ASSIGNMENT,
});

const CADRE_HINTS: Record<string, string> = {
  CHW: 'Community-based; enters hours directly',
  DATA_CLERK: 'Facility-based; start and end times',
  HCP: 'Facility-based; start and end times, in-charge endorsement',
};

/** Legal name built from the name parts, used as the account's full name. */
export function healthWorkerName(v: HealthWorkerValue, unlinked: UnlinkedStaff[] | null): string {
  if (v.mode === 'existing') return unlinked?.find((s) => String(s.id) === v.staff_id)?.legal_name || '';
  return [v.first_name, v.middle_name, v.last_name].map((p) => p.trim()).filter(Boolean).join(' ');
}

/** Build the request body, or return a message saying what is missing. `phone` becomes the staff record's verified phone (OTP number). */
export function healthWorkerPayload(v: HealthWorkerValue, phone: string): HealthWorkerPayload | string {
  if (v.mode === 'existing') {
    return v.staff_id ? { staff_id: Number(v.staff_id), staff: null } : 'Choose the staff record to link.';
  }
  if (!v.cadre_id) return 'Choose the cadre: CHW, Data Clerk or HCP.';
  if (!v.first_name.trim() || !v.last_name.trim()) return 'Enter the first and last name.';
  if (!v.assignment.region_id) return 'Choose the region where this health worker is placed.';
  if (!v.employment_start_date) return 'Enter the employment start date.';
  const other = v.occupation.trim().toLowerCase() === 'other';
  return {
    staff_id: null,
    staff: {
      cadre_id: Number(v.cadre_id),
      first_name: v.first_name.trim(),
      middle_name: v.middle_name.trim() || null,
      last_name: v.last_name.trim(),
      verified_phone: phone.trim(),
      occupation: v.occupation.trim() || null,
      occupation_other: other ? v.occupation_other.trim() || null : null,
      employment_start_date: v.employment_start_date,
      enrollment_source: 'MANUAL',
      assignment: assignmentPayload(v.assignment),
    },
  };
}

/**
 * Cadre, name and placement of a health worker, or a pick from staff records that have no login yet.
 * Creating the staff record here is what makes "My work logs" work for the account.
 */
export function HealthWorkerFields({
  value,
  onChange,
  unlinked,
  disabled,
}: {
  value: HealthWorkerValue;
  onChange: (v: HealthWorkerValue) => void;
  unlinked: UnlinkedStaff[] | null;
  disabled?: boolean;
}) {
  const cadres = useApi<Cadre[]>('/admin/cadres');
  const cadre = (cadres.data || []).find((c) => String(c.id) === value.cadre_id);
  const set = (patch: Partial<HealthWorkerValue>) => onChange({ ...value, ...patch });
  const text = (k: 'first_name' | 'middle_name' | 'last_name' | 'employment_start_date') => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value });

  return (
    <fieldset className="stack" disabled={disabled}>
      <legend>Health worker</legend>
      <Tabs
        label="Staff record"
        value={value.mode}
        onChange={(mode) => set({ mode })}
        tabs={[
          { key: 'new', label: 'Register new' },
          { key: 'existing', label: `Link existing${unlinked ? ` (${unlinked.length})` : ''}` },
        ]}
      />
      <Alert>{cadres.error && `Could not load cadres: ${cadres.error}`}</Alert>

      {value.mode === 'existing' ? (
        unlinked && unlinked.length === 0 ? (
          <p className="muted">Every active staff record already has a login. Register a new one instead.</p>
        ) : (
          <Field label="Staff record *" hint="Active staff records from the Staff registry that have no login yet.">
            <select value={value.staff_id} onChange={(e) => set({ staff_id: e.target.value })} required>
              <option value="">Choose…</option>
              {(unlinked || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.legal_name} · {s.cadre || '—'} · {s.phone}
                </option>
              ))}
            </select>
          </Field>
        )
      ) : (
        <>
          <div className="field">
            <span className="field-label">Cadre *</span>
            <div className="choice-cards" role="radiogroup" aria-label="Cadre">
              {(cadres.data || []).map((c) => (
                <label key={c.id} className={`choice-card${String(c.id) === value.cadre_id ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="cadre"
                    value={c.id}
                    checked={String(c.id) === value.cadre_id}
                    onChange={() => set({ cadre_id: String(c.id), occupation: '', occupation_other: '' })}
                  />
                  <span>
                    <strong>{c.name}</strong>
                    <span className="muted small">{CADRE_HINTS[c.code] || c.code}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid-2">
            <Field label="First name *">
              <input value={value.first_name} onChange={text('first_name')} maxLength={100} autoComplete="off" />
            </Field>
            <Field label="Middle name">
              <input value={value.middle_name} onChange={text('middle_name')} maxLength={100} autoComplete="off" />
            </Field>
            <Field label="Last name *">
              <input value={value.last_name} onChange={text('last_name')} maxLength={100} autoComplete="off" />
            </Field>
            <OccupationFields
              cadre={cadre}
              occupation={value.occupation}
              other={value.occupation_other}
              onOccupation={(v) => set({ occupation: v })}
              onOther={(v) => set({ occupation_other: v })}
            />
            <Field label="Employment start date *">
              <input type="date" value={value.employment_start_date} onChange={text('employment_start_date')} />
            </Field>
          </div>
          <p className="muted small">
            The phone number above becomes the verified phone that receives confirmation codes. Payment details can be added later on the Staff page.
          </p>
          <h4>Placement</h4>
          <AssignmentFields value={value.assignment} onChange={(assignment) => set({ assignment })} showSection={cadre ? cadre.uses_section : true} />
        </>
      )}
    </fieldset>
  );
}
