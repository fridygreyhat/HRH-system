import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Drawer, Field, WorkTypeChip } from '../components/ui';
import { cadreName, dateOnly, money, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';
import { RateActivity, RateTemplates } from '../types';

/** The agreed monthly minimums, offered as a starting point. The person adding the service can change them. */
export function suggestedDays(name: string): string {
  if (/\bsns\b/i.test(name)) return '5';
  if (/\bindex\b|\bmobile\b/i.test(name)) return '10';
  return '';
}

const UNIT_LABELS: Record<string, { en: string; sw: string }> = {
  PER_DAY: { en: 'per day', sw: 'kwa siku' }, PER_HOUR: { en: 'per hour', sw: 'kwa saa' }, PER_UNIT: { en: 'per unit', sw: 'kwa kipimo' },
};
const FORM_LABELS: Record<string, { en: string; sw: string }> = {
  CASCADE: { en: 'Cascade indicators', sw: 'Viashiria vya mfululizo' }, SINGLE: { en: 'Single count', sw: 'Hesabu moja' },
};

export function CreateRate({ lookups, onClose, onSaved }: { lookups: RateTemplates; onClose: () => void; onSaved: () => void }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const type = 'SERVICES';
  const [cadreId, setCadreId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [template, setTemplate] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [labelSw, setLabelSw] = useState('');
  const [mode, setMode] = useState<'CASCADE' | 'SINGLE'>('CASCADE');
  const [rate, setRate] = useState('');
  const [billableIndex, setBillableIndex] = useState('');
  const [effective, setEffective] = useState(todayLocal());
  const [minDays, setMinDays] = useState('');
  const [minDaysEdited, setMinDaysEdited] = useState(false);
  const action = useAction();
  const suggest = (name: string) => { if (!minDaysEdited) setMinDays(suggestedDays(name)); };
  const templates = lookups.templates.filter((item) => (!cadreId || String(item.cadre_id) === cadreId) && item.item_type === type);
  const selectedTemplate = lookups.templates.find((item) => item.key === template);
  const genericCascadeFields = [
    { key: 'appointments', label_en: 'Appointments' },
    { key: 'reached_tested', label_en: 'Reached/tested' },
    { key: 'new_positives', label_en: 'New positives' },
    { key: 'linked_to_care', label_en: 'Linked to care' },
  ];
  const billableFields = selectedTemplate?.field_definitions?.length ? selectedTemplate.field_definitions : genericCascadeFields;
  const requiresBillableIndex = false;
  const chooseTemplate = (key: string) => {
    setTemplate(key);
    setBillableIndex('');
    const item = lookups.templates.find((candidate) => candidate.key === key);
    if (item) {
      setCadreId(String(item.cadre_id));
      setMode(item.form_mode);
      if (!labelEn.trim()) setLabelEn(item.label_en);
      if (!labelSw.trim()) setLabelSw(item.label_sw);
      suggest(labelEn.trim() || item.label_en);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(rate);
    if (!cadreId || !Number.isFinite(amount) || amount < 0) {
      action.setError(sw ? 'Chagua kada na uweke kiasi sahihi.' : 'Choose a cadre and enter a valid rate.');
      return;
    }
    const days = Number(minDays);
    if (minDays === '' || !Number.isInteger(days) || days < 0 || days > 31) {
      action.setError(sw ? 'Weka siku za chini kwa mwezi, kuanzia 0 hadi 31.' : 'Enter the minimum days per month, from 0 to 31.');
      return;
    }
    if (requiresBillableIndex && (billableIndex === '' || Number(billableIndex) < 0 || Number(billableIndex) >= billableFields.length)) {
      action.setError(sw ? 'Chagua kiashiria kinacholipwa.' : 'Choose the billable indicator for a cascade per-unit rate.');
      return;
    }
    const result = await action.run(() => api.post<RateActivity>('/rates', {
      label_en: labelEn.trim(),
      label_sw: labelSw.trim(),
      cadre_id: Number(cadreId),
      region_id: Number(regionId),
      item_type: type,
      form_mode: mode,
      ...(template ? { template_key: template } : {}),
      rate_value: amount,
      currency: 'TZS',
      unit_type: 'PER_DAY',
      effective_start_date: effective,
      min_days_per_month: days,
      ...(requiresBillableIndex ? { billable_index: Number(billableIndex) } : {}),
    }));
    if (result) onSaved();
  };
  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-2">
        <Field label={sw ? 'Aina ya kazi' : 'Work type'}><input value={sw ? 'Huduma — kiasi cha kudumu kwa siku' : 'Services — fixed daily amount'} readOnly /></Field>
        <Field label={sw ? 'Kada' : 'Cadre'}>
          <select required value={cadreId} onChange={(event) => { setCadreId(event.target.value); setTemplate(''); }}>
            <option value="">{sw ? 'Chagua…' : 'Choose…'}</option>{lookups.cadres.map((cadre) => <option key={cadre.id} value={cadre.id}>{sw ? cadreName(cadre.code, lang) : cadre.name} ({cadre.code})</option>)}
          </select>
        </Field>
        <Field label={sw ? 'Jina la shughuli (Kiingereza)' : 'Activity name (English)'}>
          <input required maxLength={160} value={labelEn} onChange={(event) => { setLabelEn(event.target.value); suggest(event.target.value); }} />
        </Field>
        <Field label={sw ? 'Jina la shughuli (Kiswahili)' : 'Activity name (Kiswahili)'}>
          <input required maxLength={160} value={labelSw} onChange={(event) => setLabelSw(event.target.value)} />
        </Field>
        <Field label={sw ? 'Mkoa' : 'Region'}>
          <select required value={regionId} onChange={(event) => setRegionId(event.target.value)}>
            <option value="">{sw ? 'Chagua…' : 'Choose…'}</option>{lookups.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </Field>
        <Field label={sw ? 'Kiolezo cha viashiria' : 'Indicator template'}>
          <select value={template} onChange={(event) => chooseTemplate(event.target.value)}>
            <option value="">{sw ? 'Bila kiolezo' : 'No template'}</option>{templates.map((item) => <option key={item.key} value={item.key}>{sw ? item.label_sw || item.label_en : item.label_en}</option>)}
          </select>
        </Field>
        {type === 'SERVICES' && (
          <Field label={sw ? 'Fomu ya kujaza' : 'Entry form'}>
            <select value={mode} onChange={(event) => { setMode(event.target.value as 'CASCADE' | 'SINGLE'); setBillableIndex(''); }}>
              <option value="CASCADE">{sw ? FORM_LABELS.CASCADE.sw : FORM_LABELS.CASCADE.en}</option><option value="SINGLE">{sw ? FORM_LABELS.SINGLE.sw : FORM_LABELS.SINGLE.en}</option>
            </select>
          </Field>
        )}
        <Field label={sw ? 'Kiasi cha kudumu kwa huduma kwa siku (TZS)' : 'Fixed amount per service per day (TZS)'}>
          <input type="number" min="0" step="any" required value={rate} onChange={(event) => setRate(event.target.value)} />
        </Field>
        <Field label={sw ? 'Siku za chini kwa mwezi' : 'Minimum days per month'} hint={sw ? 'Kwa mwezi wa malipo (tarehe 26 hadi 25). Weka 0 kama hakuna kiwango cha chini.' : 'Per pay month (26th to 25th). Enter 0 for no minimum.'}>
          <input type="number" min="0" max="31" step="1" required value={minDays} onChange={(event) => { setMinDays(event.target.value); setMinDaysEdited(true); }} />
        </Field>
        <Field label={sw ? 'Kanuni ya malipo' : 'Payment rule'}><input readOnly value={sw ? 'Huduma moja kwa siku — kiasi cha juu zaidi' : 'One service per day — highest fixed amount'} /></Field>
        <Field label={sw ? 'Inaanza kutumika' : 'Effective from'}>
          <input type="date" required value={effective} onChange={(event) => setEffective(event.target.value)} />
        </Field>
      </div>
      {requiresBillableIndex && (
        <Field label={sw ? 'Kiashiria kinacholipwa' : 'Billable indicator'} hint={sw ? 'Huweka kiasi kinacholipwa kwa kila kipimo.' : 'Sets the per-unit payable amount.'}>
          <select required value={billableIndex} onChange={(event) => setBillableIndex(event.target.value)}>
            <option value="">{sw ? 'Chagua kiashiria…' : 'Choose indicator…'}</option>
            {billableFields.map((field, index) => <option key={`${field.key}-${index}`} value={index}>{field.label_en}</option>)}
          </select>
        </Field>
      )}
      <Alert>{action.error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={action.busy}>{action.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi kiasi cha huduma' : 'Create rate definition')}</button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={action.busy}>{sw ? 'Ghairi' : 'Cancel'}</button>
      </div>
    </form>
  );
}

function ReviseRate({ activity, onClose, onSaved }: { activity: RateActivity; onClose: () => void; onSaved: () => void }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const [rate, setRate] = useState(String(activity.rate_value));
  const [date, setDate] = useState(todayLocal());
  const [minDays, setMinDays] = useState(String(activity.min_days_per_month ?? suggestedDays(activity.label_en)));
  const action = useAction();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) return action.setError(sw ? 'Weka kiasi sahihi cha sifuri au zaidi.' : 'Enter a valid rate of zero or more.');
    const days = Number(minDays);
    if (minDays === '' || !Number.isInteger(days) || days < 0 || days > 31) return action.setError(sw ? 'Weka siku za chini kwa mwezi, kuanzia 0 hadi 31.' : 'Enter the minimum days per month, from 0 to 31.');
    const result = await action.run(() => api.post<RateActivity>(`/rates/${activity.id}/revise`, { rate_value: value, effective_start_date: date, min_days_per_month: days }));
    if (result) onSaved();
  };
  return <form className="stack" onSubmit={submit}>
    <p className="notice notice-info">{sw ? 'Huunda toleo jipya; kazi iliyorekodiwa na kulipwa inabaki na viasi vyake.' : 'Creates a new version; recorded and paid work keep their amounts.'}</p>
    <Field label={sw ? 'Kiasi kipya cha kudumu kwa siku (TZS)' : 'New fixed daily amount (TZS)'}><input type="number" min="0" step="any" required value={rate} onChange={(event) => setRate(event.target.value)} /></Field>
    <Field label={sw ? 'Siku za chini kwa mwezi' : 'Minimum days per month'} hint={sw ? 'Weka 0 kama hakuna kiwango cha chini.' : 'Enter 0 for no minimum.'}><input type="number" min="0" max="31" step="1" required value={minDays} onChange={(event) => setMinDays(event.target.value)} /></Field>
    <Field label={sw ? 'Inaanza kutumika' : 'Effective from'}><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></Field>
    <Alert>{action.error}</Alert>
    <div className="row"><button className="btn btn-primary" disabled={action.busy}>{action.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi toleo jipya' : 'Create revision')}</button><button type="button" className="btn btn-ghost" onClick={onClose}>{sw ? 'Ghairi' : 'Cancel'}</button></div>
  </form>;
}

export function Rates() {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const canEdit = hasRole('TECHNICAL_OFFICER');
  const rates = useApi<RateActivity[]>('/rates');
  const templates = useApi<RateTemplates>('/rates/templates');
  const [type, setType] = useState('SERVICES');
  const [cadreId, setCadreId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RateActivity | null>(null);
  const [notice, setNotice] = useState('');
  const visible = useMemo(() => (rates.data || []).filter((activity) => (!type || activity.item_type === type) && (!cadreId || String(activity.cadre_id) === cadreId)), [rates.data, type, cadreId]);
  const reload = () => { rates.reload(); setCreating(false); setEditing(null); setNotice(sw ? 'Kiasi cha huduma kimehifadhiwa.' : 'Rate definition saved.'); };
  const word = (map: Record<string, { en: string; sw: string }>, key: string) => (map[key] ? map[key][sw ? 'sw' : 'en'] : key.replace(/_/g, ' ').toLowerCase());
  return (
    <div className="stack-lg">
      <header className="page-header">
        <div><h1>{sw ? 'Viasi vya huduma kwa siku' : 'Service daily amounts'}</h1><p className="muted small">{sw ? 'Kiasi cha juu zaidi pekee hulipwa kwa mtoa huduma kwa siku.' : 'Only the highest amount is paid per provider per day.'}</p></div>
      </header>
      <Alert kind="success">{notice}</Alert>
      <Alert>{templates.error}</Alert>
      <div className="row-between">
        <div className="filters">
          <Field label={sw ? 'Aina ya kazi' : 'Work type'}><select value={type} onChange={(event) => setType(event.target.value)}><option value="">{sw ? 'Aina zote' : 'All types'}</option><option value="SERVICES">{sw ? 'Huduma' : 'Services'}</option><option value="PAYROLL">Payroll</option></select></Field>
          <Field label={sw ? 'Kada' : 'Cadre'}><select value={cadreId} onChange={(event) => setCadreId(event.target.value)}><option value="">{sw ? 'Kada zote' : 'All cadres'}</option>{(templates.data?.cadres || []).map((cadre) => <option key={cadre.id} value={cadre.id}>{sw ? cadreName(cadre.code, lang) : cadre.name}</option>)}</select></Field>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => { setNotice(''); setCreating(true); }} disabled={!templates.data}>{sw ? 'Ongeza kiasi cha huduma' : 'Add rate definition'}</button>}
      </div>
      <AsyncState data={rates.data} error={rates.error} loading={rates.loading} empty={sw ? 'Hakuna viasi vya huduma katika eneo lako.' : 'No rate definitions are visible in your scope.'}>
        {() => visible.length ? <div className="table-wrap"><table>
          <thead><tr>
            <th>{sw ? 'Shughuli' : 'Activity'}</th><th>{sw ? 'Aina' : 'Type'}</th><th>{sw ? 'Kada / mkoa' : 'Cadre / region'}</th>
            <th>{sw ? 'Vipimo' : 'Measures'}</th><th className="num">{sw ? 'Siku za chini / mwezi' : 'Min. days / month'}</th>
            <th className="num">{sw ? 'Kiasi' : 'Rate'}</th><th>{sw ? 'Inaanza' : 'Effective'}</th><th>{sw ? 'Hali' : 'Status'}</th><th><span className="sr-only">{sw ? 'Hatua' : 'Actions'}</span></th>
          </tr></thead>
          <tbody>{visible.map((activity) => {
            const cadre = templates.data?.cadres.find((item) => item.id === activity.cadre_id);
            const region = templates.data?.regions.find((item) => item.id === activity.region_id);
            const labels = activity.field_definitions.map((field) => field.label_en);
            const billable = activity.billable_field ? activity.field_definitions.find((field) => field.key === activity.billable_field)?.label_en || activity.billable_field : null;
            const form = activity.item_type === 'PAYROLL' ? (sw ? 'Masaa tu' : 'Hours only') : word(FORM_LABELS, activity.form_mode);
            return <tr key={activity.id}>
              <td><span className="cell-main">{sw ? activity.label_sw || activity.label_en : activity.label_en}</span><span className="cell-sub">{sw ? activity.label_en : activity.label_sw} · {activity.key}</span></td>
              <td><WorkTypeChip type={activity.item_type} /><span className="cell-sub">{form}</span></td>
              <td><span className="cell-main">{cadre ? (sw ? cadreName(cadre.code, lang) : cadre.name) : activity.cadre_id}</span><span className="cell-sub">{region?.name || (sw ? 'Mikoa yote ya eneo lako' : 'All scoped regions')}</span></td>
              <td className="small">{labels.length ? labels.join(', ') : activity.item_type === 'PAYROLL' ? (sw ? 'Hakuna' : 'None') : activity.fields.join(', ') || (sw ? 'Hesabu moja' : 'Single count')}{billable && <span className="cell-sub">{sw ? 'Kinacholipwa' : 'Billable'}: {billable}</span>}</td>
              <td className="num">{activity.min_days_per_month ? activity.min_days_per_month : '—'}</td>
              <td className="num"><span className="cell-main">{money(activity.rate_value, activity.currency)}</span><span className="cell-sub">{word(UNIT_LABELS, activity.unit_type)}</span></td>
              <td className="nowrap">{dateOnly(activity.effective_start_date)}</td>
              <td><span className={`badge ${activity.is_active ? 'badge-success' : 'badge-neutral'}`}>{activity.is_active ? (sw ? 'Inatumika' : 'Active') : (sw ? 'Haitumiki' : 'Inactive')}</span></td>
              <td>{canEdit && activity.item_type === 'SERVICES' && <button className="btn btn-secondary btn-sm nowrap" onClick={() => setEditing(activity)}>{sw ? 'Badilisha kiasi' : 'Revise daily amount'}</button>}{activity.item_type === 'PAYROLL' && <span className="muted small">{sw ? 'Kumbukumbu tu' : 'Historical only'}</span>}</td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="empty">{sw ? 'Hakuna kinacholingana na vichujio hivi.' : 'No definitions match these filters.'}</p>}
      </AsyncState>
      {canEdit && creating && templates.data && <Drawer title={sw ? 'Ongeza kiasi cha huduma' : 'Add rate definition'} onClose={() => setCreating(false)} wide><CreateRate lookups={templates.data} onClose={() => setCreating(false)} onSaved={reload} /></Drawer>}
      {canEdit && editing && <Drawer title={sw ? `Badilisha ${editing.label_sw || editing.label_en}` : `Revise ${editing.label_en}`} onClose={() => setEditing(null)}><ReviseRate activity={editing} onClose={() => setEditing(null)} onSaved={reload} /></Drawer>}
    </div>
  );
}
