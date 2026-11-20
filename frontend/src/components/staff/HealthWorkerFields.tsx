import React from 'react';
import { useApi } from '../../hooks';
import { todayLocal } from '../../format';
import { Cadre } from '../../types';
import { Alert, Field, Tabs } from '../ui';
import { AssignmentFields, AssignmentPayload, AssignmentValue, EMPTY_ASSIGNMENT, assignmentPayload } from './AssignmentFields';
import { OccupationFields } from './StaffForms';
import { EMPTY_PROVIDER_PAY, NO_PROVIDER_PAY, ProviderPay, ProviderPayFields, providerPayPayload, SERVICES_ONLY_NOTE } from './ProviderPayFields';
import { identityPayload, IdType } from '../../nationalId';
import { EMPTY_NATIONAL_ID, NationalIdFields, NationalIdValue } from './NationalIdFields';
import { FACILITY_STAFF_TYPE_MESSAGE, FacilityStaffType, FacilityStaffTypeField, isHcp } from './FacilityStaffType';

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
  /** The chosen cadre's code (CHW, DATA_CLERK, HCP), kept with the id for the checks before sending. */
  cadre_code: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  occupation: string;
  occupation_other: string;
  /** HCP only: Government or Project facility staff. */
  facility_staff_type: FacilityStaffType | '';
  /** National ID (NIDA) or Voter ID: required when registering. */
  national_id: NationalIdValue;
  /** TIN and bank details: required of every provider registered here. */
  pay: ProviderPay;
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
        id_type: IdType | null;
        id_number: string | null;
        /** Empty for Government facility staff, who are paid for Services only. */
        tin_number: string | null;
        bank_name: string | null;
        bank_account_number: string | null;
        occupation: string | null;
        occupation_other: string | null;
        facility_staff_type: FacilityStaffType | null;
        employment_start_date: string;
        enrollment_source: 'MANUAL';
        assignment: AssignmentPayload;
      };
    };

export const emptyHealthWorker = (): HealthWorkerValue => ({
  mode: 'new',
  staff_id: '',
  cadre_id: '',
  cadre_code: '',
  first_name: '',
  middle_name: '',
  last_name: '',
  occupation: '',
  occupation_other: '',
  facility_staff_type: '',
  national_id: EMPTY_NATIONAL_ID,
  pay: EMPTY_PROVIDER_PAY,
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
  if (!v.occupation.trim()) return 'Choose the position, e.g. Clinical Officer or Facility Data Clerk.';
  const hcp = isHcp(v.cadre_code);
  if (hcp && !v.facility_staff_type) return FACILITY_STAFF_TYPE_MESSAGE;
  const identity = identityPayload(v.national_id.id_type, v.national_id.id_number);
  if (typeof identity === 'string') return identity;
  if (!v.assignment.region_id) return 'Choose the region where this health worker is placed.';
  if (!v.employment_start_date) return 'Enter the employment start date.';
  // Government facility staff are paid for Services only: no TIN or bank account.
  const payment = hcp && v.facility_staff_type === 'GOVERNMENT' ? NO_PROVIDER_PAY : providerPayPayload(v.pay);
  if (typeof payment === 'string') return payment;
  const other = v.occupation.trim().toLowerCase() === 'other';
  return {
    staff_id: null,
    staff: {
      cadre_id: Number(v.cadre_id),
      first_name: v.first_name.trim(),
      middle_name: v.middle_name.trim() || null,
      last_name: v.last_name.trim(),
      verified_phone: phone.trim(),
      ...identity,
      ...payment,
      occupation: v.occupation.trim() || null,
      occupation_other: other ? v.occupation_other.trim() || null : null,
      facility_staff_type: hcp ? v.facility_staff_type || null : null,
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
          <p className="muted">All active staff records already have a login.</p>
        ) : (
          <Field label="Staff record *" hint="Active staff without a login.">
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
                    onChange={() => set({ cadre_id: String(c.id), cadre_code: c.code, occupation: '', occupation_other: '', facility_staff_type: '' })}
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
              required
            />
            {isHcp(cadre?.code) && (
              <div className="grid-full">
                <FacilityStaffTypeField name="worker_facility_staff_type" value={value.facility_staff_type} onChange={(v) => set({ facility_staff_type: v })} />
              </div>
            )}
            <NationalIdFields value={value.national_id} onChange={(national_id) => set({ national_id })} disabled={disabled} />
            <Field label="Employment start date *">
              <input type="date" value={value.employment_start_date} onChange={text('employment_start_date')} />
            </Field>
          </div>
          <p className="muted small">The phone above receives confirmation codes, and Services are paid to its mobile wallet.</p>
          {isHcp(cadre?.code) && value.facility_staff_type === 'GOVERNMENT' ? (
            <div className="notice notice-info">{SERVICES_ONLY_NOTE}</div>
          ) : (
            <ProviderPayFields value={value.pay} onChange={(pay) => set({ pay })} disabled={disabled} />
          )}
          <h4>Placement</h4>
          <AssignmentFields value={value.assignment} onChange={(assignment) => set({ assignment })} showSection={cadre ? cadre.uses_section : true} />
        </>
      )}
    </fieldset>
  );
}
