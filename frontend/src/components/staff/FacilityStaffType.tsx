import React from 'react';

/** An HCP is either a government facility's own staff or staff the project placed at the facility. */
export type FacilityStaffType = 'GOVERNMENT' | 'PROJECT';

export const FACILITY_STAFF_TYPES: { value: FacilityStaffType; label: string; hint: string }[] = [
  { value: 'GOVERNMENT', label: 'Government facility staff', hint: 'Employed by the government at this facility' },
  { value: 'PROJECT', label: 'Project facility staff', hint: 'Placed at the facility by the project' },
];

export const FACILITY_STAFF_TYPE_MESSAGE = 'Choose whether this HCP is Government facility staff or Project facility staff.';

export function facilityStaffTypeLabel(value: string | null | undefined): string | null {
  return FACILITY_STAFF_TYPES.find((t) => t.value === value)?.label || null;
}

/** Only HCP staff have a facility staff type. */
export const isHcp = (cadreCode: string | null | undefined) => cadreCode === 'HCP';

export function FacilityStaffTypeField({
  value,
  onChange,
  name = 'facility_staff_type',
  required = true,
}: {
  value: string;
  onChange: (v: FacilityStaffType) => void;
  name?: string;
  required?: boolean;
}) {
  return (
    <div className="field">
      <span className="field-label">HCP type{required ? ' *' : ''}</span>
      <div className="choice-cards" role="radiogroup" aria-label="HCP type">
        {FACILITY_STAFF_TYPES.map((t) => (
          <label key={t.value} className={`choice-card${value === t.value ? ' is-selected' : ''}`}>
            <input type="radio" name={name} value={t.value} checked={value === t.value} onChange={() => onChange(t.value)} required={required} />
            <span>
              <strong>{t.label}</strong>
              <span className="muted small">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
