import React from 'react';
import { ID_TYPES, IdType } from '../../nationalId';
import { Field } from '../ui';

export interface NationalIdValue {
  id_type: IdType | '';
  id_number: string;
}

export const EMPTY_NATIONAL_ID: NationalIdValue = { id_type: '', id_number: '' };

/** The person's National ID (NIDA) or Voter ID: choose the document, then type its number. */
export function NationalIdFields({ value, onChange, required = true, disabled }: {
  value: NationalIdValue;
  onChange: (v: NationalIdValue) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const chosen = ID_TYPES.find((t) => t.value === value.id_type);
  const mark = required ? ' (required)' : '';
  return (
    <>
      <Field label={`ID type${mark}`} hint="National ID (NIDA) or Voter ID">
        <select value={value.id_type} onChange={(e) => onChange({ ...value, id_type: e.target.value as IdType | '' })}
          required={required} disabled={disabled}>
          <option value="">Select…</option>
          {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label={`${chosen ? chosen.label : 'ID'} number${mark}`} hint={chosen?.hint || 'Choose the ID type first.'}>
        <input value={value.id_number} onChange={(e) => onChange({ ...value, id_number: e.target.value })}
          inputMode={value.id_type === 'NIDA' ? 'numeric' : 'text'} maxLength={40} autoComplete="off"
          placeholder={chosen?.placeholder} required={required} disabled={disabled || !value.id_type} />
      </Field>
    </>
  );
}
