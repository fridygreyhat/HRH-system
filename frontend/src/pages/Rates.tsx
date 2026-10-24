import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Drawer, Field } from '../components/ui';
import { dateOnly, money, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';
import { RateActivity, RateTemplates } from '../types';

function CreateRate({ lookups, onClose, onSaved }: { lookups: RateTemplates; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'SERVICES' | 'PAYROLL'>('SERVICES');
  const [cadreId, setCadreId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [template, setTemplate] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelSw, setLabelSw] = useState('');
  const [mode, setMode] = useState<'CASCADE' | 'SINGLE'>('CASCADE');
  const [rate, setRate] = useState('');
  const [unit, setUnit] = useState<'PER_UNIT' | 'PER_HOUR' | 'PER_DAY'>('PER_UNIT');
  const [billableIndex, setBillableIndex] = useState('');
  const [effective, setEffective] = useState(todayLocal());
  const action = useAction();
  const templates = lookups.templates.filter((item) => (!cadreId || String(item.cadre_id) === cadreId) && item.item_type === type);
  const selectedTemplate = lookups.templates.find((item) => item.key === template);
  const genericCascadeFields = [
    { key: 'appointments', label_en: 'Appointments' },
    { key: 'reached_tested', label_en: 'Reached/tested' },
    { key: 'new_positives', label_en: 'New positives' },
    { key: 'linked_to_care', label_en: 'Linked to care' },
  ];
  const billableFields = selectedTemplate?.field_definitions?.length ? selectedTemplate.field_definitions : genericCascadeFields;
  const requiresBillableIndex = type === 'SERVICES' && mode === 'CASCADE' && unit === 'PER_UNIT';
  const chooseTemplate = (key: string) => {
    setTemplate(key);
    setBillableIndex('');
    const item = lookups.templates.find((candidate) => candidate.key === key);
    if (item) {
      setCadreId(String(item.cadre_id));
      setMode(item.form_mode);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(rate);
    if (!cadreId || !Number.isFinite(amount) || amount < 0) {
      action.setError('Choose a cadre and enter a valid rate.');
      return;
    }
    if (type === 'PAYROLL' && (mode !== 'SINGLE' || unit !== 'PER_HOUR')) {
      action.setError('Payroll activity is always single-measure and paid per hour.');
      return;
    }
    if (requiresBillableIndex && (billableIndex === '' || Number(billableIndex) < 0 || Number(billableIndex) >= billableFields.length)) {
      action.setError('Choose the billable indicator for a cascade per-unit rate.');
      return;
    }
    const result = await action.run(() => api.post<RateActivity>('/rates', {
      label_en: labelEn.trim(),
      label_sw: labelSw.trim(),
      cadre_id: Number(cadreId),
      region_id: regionId ? Number(regionId) : null,
      item_type: type,
      form_mode: type === 'PAYROLL' ? 'SINGLE' : mode,
      ...(template ? { template_key: template } : {}),
      rate_value: amount,
      currency: 'TZS',
      unit_type: type === 'PAYROLL' ? 'PER_HOUR' : unit,
      effective_start_date: effective,
      ...(requiresBillableIndex ? { billable_index: Number(billableIndex) } : {}),
    }));
    if (result) onSaved();
  };
  return (
    <form className="stack" onSubmit={submit}>
      <p className="notice notice-info">A revised rate creates a new activity version. Existing work entries retain their original finance snapshot.</p>
      <div className="grid-2">
        <Field label="Work type">
          <select value={type} onChange={(event) => { setType(event.target.value as 'SERVICES' | 'PAYROLL'); setTemplate(''); setBillableIndex(''); setMode(event.target.value === 'PAYROLL' ? 'SINGLE' : 'CASCADE'); setUnit(event.target.value === 'PAYROLL' ? 'PER_HOUR' : 'PER_UNIT'); }}>
            <option value="SERVICES">Services</option><option value="PAYROLL">Payroll</option>
          </select>
        </Field>
        <Field label="Cadre">
          <select required value={cadreId} onChange={(event) => { setCadreId(event.target.value); setTemplate(''); }}>
            <option value="">Choose…</option>{lookups.cadres.map((cadre) => <option key={cadre.id} value={cadre.id}>{cadre.name} ({cadre.code})</option>)}
          </select>
        </Field>
        <Field label="Activity name (English)">
          <input required maxLength={160} value={labelEn} onChange={(event) => setLabelEn(event.target.value)} />
        </Field>
        <Field label="Activity name (Kiswahili)">
          <input required maxLength={160} value={labelSw} onChange={(event) => setLabelSw(event.target.value)} />
        </Field>
        <Field label="Region">
          <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
            <option value="">All available regions</option>{lookups.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </Field>
        <Field label="Indicator template" hint="Templates preserve the existing clinical indicator set.">
          <select value={template} onChange={(event) => chooseTemplate(event.target.value)}>
            <option value="">No template</option>{templates.map((item) => <option key={item.key} value={item.key}>{item.label_en}</option>)}
          </select>
        </Field>
        {type === 'SERVICES' && (
          <Field label="Entry form">
            <select value={mode} onChange={(event) => { setMode(event.target.value as 'CASCADE' | 'SINGLE'); setBillableIndex(''); }}>
              <option value="CASCADE">Cascade indicators</option><option value="SINGLE">Single count</option>
            </select>
          </Field>
        )}
        <Field label="Rate per unit (TZS)">
          <input type="number" min="0" step="any" required value={rate} onChange={(event) => setRate(event.target.value)} />
        </Field>
        <Field label="Rate unit">
          <select value={type === 'PAYROLL' ? 'PER_HOUR' : unit} disabled={type === 'PAYROLL'} onChange={(event) => { setUnit(event.target.value as typeof unit); setBillableIndex(''); }}>
            <option value="PER_UNIT">Per count</option><option value="PER_DAY">Per day</option><option value="PER_HOUR">Per hour</option>
          </select>
        </Field>
        <Field label="Effective from">
          <input type="date" required value={effective} onChange={(event) => setEffective(event.target.value)} />
        </Field>
      </div>
      {requiresBillableIndex && (
        <Field label="Billable indicator" hint="The selected cascade measure determines the per-unit payable amount.">
          <select required value={billableIndex} onChange={(event) => setBillableIndex(event.target.value)}>
            <option value="">Choose indicator…</option>
            {billableFields.map((field, index) => <option key={`${field.key}-${index}`} value={index}>{field.label_en}</option>)}
          </select>
        </Field>
      )}
      {type === 'PAYROLL' && <p className="muted small">Payroll entries capture hours only; no additional measures are collected.</p>}
      {type === 'SERVICES' && mode === 'CASCADE' && !template && <p className="muted small">A cascade service form is generated with the four configured funnel measures.</p>}
      {type === 'SERVICES' && mode === 'SINGLE' && <p className="muted small">A single service form collects one count measure.</p>}
      <Alert>{action.error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={action.busy}>{action.busy ? 'Saving…' : 'Create rate definition'}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={action.busy}>Cancel</button>
      </div>
    </form>
  );
}

function ReviseRate({ activity, onClose, onSaved }: { activity: RateActivity; onClose: () => void; onSaved: () => void }) {
  const [rate, setRate] = useState(String(activity.rate_value));
  const [date, setDate] = useState(todayLocal());
  const action = useAction();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) return action.setError('Enter a valid rate of zero or more.');
    const result = await action.run(() => api.post<RateActivity>(`/rates/${activity.id}/revise`, { rate_value: value, effective_start_date: date }));
    if (result) onSaved();
  };
  return <form className="stack" onSubmit={submit}>
    <p className="notice notice-info">This creates a new immutable rate version. Paid history is not recalculated.</p>
    <Field label="New rate (TZS)"><input type="number" min="0" step="any" required value={rate} onChange={(event) => setRate(event.target.value)} /></Field>
    <Field label="Effective from"><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></Field>
    <Alert>{action.error}</Alert>
    <div className="row"><button className="btn btn-primary" disabled={action.busy}>{action.busy ? 'Saving…' : 'Create revision'}</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
  </form>;
}

export function Rates() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('TECHNICAL_OFFICER');
  const rates = useApi<RateActivity[]>('/rates');
  const templates = useApi<RateTemplates>('/rates/templates');
  const [type, setType] = useState('');
  const [cadreId, setCadreId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RateActivity | null>(null);
  const [notice, setNotice] = useState('');
  const visible = useMemo(() => (rates.data || []).filter((activity) => (!type || activity.item_type === type) && (!cadreId || String(activity.cadre_id) === cadreId)), [rates.data, type, cadreId]);
  const reload = () => { rates.reload(); setCreating(false); setEditing(null); setNotice('Rate definition saved. Existing entries and paid history remain unchanged.'); };
  return (
    <div className="stack-lg">
      <header className="page-header">
        <div><h1>Rates</h1><p className="muted small">Scoped activity definitions and effective-dated rates. Decisions use the saved snapshot, never today’s rate.</p></div>
        {canEdit && <button className="btn btn-primary" onClick={() => { setNotice(''); setCreating(true); }} disabled={!templates.data}>Add rate definition</button>}
      </header>
      {canEdit && <p className="notice notice-info">Technical Officers may create and revise definitions. Finance and oversight roles can inspect rates only.</p>}
      <Alert kind="success">{notice}</Alert>
      <Alert>{templates.error}</Alert>
      <div className="filters">
        <Field label="Work type"><select value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option><option value="SERVICES">Services</option><option value="PAYROLL">Payroll</option></select></Field>
        <Field label="Cadre"><select value={cadreId} onChange={(event) => setCadreId(event.target.value)}><option value="">All cadres</option>{(templates.data?.cadres || []).map((cadre) => <option key={cadre.id} value={cadre.id}>{cadre.name}</option>)}</select></Field>
      </div>
      <AsyncState data={rates.data} error={rates.error} loading={rates.loading} empty="No rate definitions are visible in your scope.">
        {() => visible.length ? <div className="table-wrap"><table>
          <thead><tr><th>Activity</th><th>Type</th><th>Cadre</th><th>Region</th><th>Form</th><th>Measures</th><th>Billable indicator</th><th>Unit</th><th className="num">Rate</th><th>Effective</th><th>Status</th><th /></tr></thead>
          <tbody>{visible.map((activity) => {
            const cadre = templates.data?.cadres.find((item) => item.id === activity.cadre_id);
            const region = templates.data?.regions.find((item) => item.id === activity.region_id);
            const labels = activity.field_definitions.map((field) => field.label_en);
            return <tr key={activity.id}>
              <td><strong>{activity.label_en}</strong><div className="muted small">{activity.label_sw} · {activity.key}</div></td>
              <td>{activity.item_type}</td><td>{cadre?.name || activity.cadre_id}</td><td>{region?.name || 'All scoped regions'}</td>
              <td>{activity.item_type === 'PAYROLL' ? 'Hours only' : activity.form_mode}</td>
              <td className="small">{labels.length ? labels.join(', ') : activity.item_type === 'PAYROLL' ? 'None' : activity.fields.join(', ') || 'Single count'}</td>
              <td>{activity.billable_field ? activity.field_definitions.find((field) => field.key === activity.billable_field)?.label_en || activity.billable_field : '—'}</td>
              <td>{activity.unit_type.replace('_', ' ').toLowerCase()}</td><td className="num nowrap">{money(activity.rate_value, activity.currency)}</td><td className="nowrap">{dateOnly(activity.effective_start_date)}</td>
              <td><span className={`badge ${activity.is_active ? 'badge-success' : 'badge-neutral'}`}>{activity.is_active ? 'Active' : 'Inactive'}</span></td>
              <td>{canEdit && <button className="btn btn-secondary btn-sm" onClick={() => setEditing(activity)}>Revise</button>}</td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="empty">No definitions match these filters.</p>}
      </AsyncState>
      {canEdit && creating && templates.data && <Drawer title="Add rate definition" onClose={() => setCreating(false)} wide><CreateRate lookups={templates.data} onClose={() => setCreating(false)} onSaved={reload} /></Drawer>}
      {canEdit && editing && <Drawer title={`Revise ${editing.label_en}`} onClose={() => setEditing(null)}><ReviseRate activity={editing} onClose={() => setEditing(null)} onSaved={reload} /></Drawer>}
    </div>
  );
}
