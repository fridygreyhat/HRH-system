import React from 'react';
import { CadreActivity, CadreField } from '../../types';
import { Field } from '../ui';

export interface ServiceDraft {
  activity_key: string;
  activity_location?: string | null;
  measures: Record<string, string | number | boolean>;
}

export function AdditionalServices({ activities, fields, primaryKey, value, onChange, lang }: {
  activities: CadreActivity[]; fields: CadreField[]; primaryKey: string;
  value: ServiceDraft[]; onChange: (value: ServiceDraft[]) => void; lang: string;
}) {
  const update = (index: number, patch: Partial<ServiceDraft>) =>
    onChange(value.map((item, i) => i === index ? { ...item, ...patch } : item));
  const available = activities.filter(activity => activity.key !== primaryKey && !value.some(item => item.activity_key === activity.key));
  return <section className="stack" aria-label="Additional services">
    <p className="notice notice-info">Record all services performed on this date. Hours are the total for the day, not repeated for each service. Payment is only the highest fixed daily service amount, not the sum.</p>
    {value.map((item, index) => {
      const activity = activities.find(candidate => candidate.key === item.activity_key);
      return <fieldset className="card stack" key={item.activity_key}>
        <legend>{activity?.[lang === 'sw' ? 'label_sw' : 'label_en'] || item.activity_key}</legend>
        {activity?.requires_location && <Field label="Secondary facility name"><input required maxLength={255} value={item.activity_location || ''} onChange={e => update(index, { activity_location: e.target.value })} /></Field>}
        {(activity?.fields || []).map(key => {
          const field = fields.find(candidate => candidate.key === key);
          if (!field) return null;
          const required = activity?.required_fields?.includes(key);
          return <Field key={key} label={field[lang === 'sw' ? 'label_sw' : 'label_en']}>
            {field.field_type === 'BOOLEAN'
              ? <select required={required} value={item.measures[key] === undefined ? '' : String(item.measures[key])} onChange={e => update(index, { measures: { ...item.measures, [key]: e.target.value === '' ? '' : e.target.value === 'true' } })}>
                <option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option>
              </select>
              : <input required={required} type="number" min="0" max="10000" step="1" value={String(item.measures[key] ?? '')} onChange={e => update(index, { measures: { ...item.measures, [key]: e.target.value } })} />}
          </Field>;
        })}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove this service</button>
      </fieldset>;
    })}
    <Field label="Add another service on this date">
      <select value="" disabled={available.length === 0} onChange={e => { if (e.target.value) onChange([...value, { activity_key: e.target.value, measures: {} }]); }}>
        <option value="">{available.length ? 'Choose another service…' : 'No other services available'}</option>
        {available.map(activity => <option value={activity.key} key={activity.key}>{activity[lang === 'sw' ? 'label_sw' : 'label_en']}</option>)}
      </select>
    </Field>
  </section>;
}
