import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, humanize, money, todayLocal } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Cadre, ClaimCategory, Named, RateRule } from '../../types';
import { Alert, AsyncState, Drawer, Field, Modal, StatusBadge } from '../../components/ui';
import { refName } from './common';

const UNIT_TYPES: Record<RateRule['unit_type'], string> = {
  PER_DAY: 'Per day worked',
  PER_HOUR: 'Per hour worked',
  PER_UNIT: 'Per unit of a work-log measure',
  FIXED: 'Fixed amount',
};
const STATUSES = ['ACTIVE', 'RETIRED'];

interface Lookups {
  categories: ClaimCategory[];
  cadres: Cadre[];
  regions: Named[];
}

function RateForm({ lookups, initial, onDone, onCancel }: { lookups: Lookups; initial?: RateRule; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    category_id: initial ? String(initial.category_id) : '',
    cadre_id: initial?.cadre_id ? String(initial.cadre_id) : '',
    region_id: initial?.region_id ? String(initial.region_id) : '',
    component_name: initial?.component_name || '',
    unit_type: initial?.unit_type || 'PER_DAY' as RateRule['unit_type'],
    measure_key: initial?.measure_key || '',
    rate_value: initial ? String(initial.rate_value) : '',
    currency: initial?.currency || 'TZS',
    cap_amount: initial?.cap_amount != null ? String(initial.cap_amount) : '',
    effective_start_date: initial?.effective_start_date || todayLocal(),
    effective_end_date: initial?.effective_end_date || '',
  });
  const { busy, error, setError, run } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cadre = lookups.cadres.find((c) => String(c.id) === form.cadre_id);
  const measureOptions = cadre ? cadre.fields : lookups.cadres.flatMap((c) => c.fields.map((f) => ({ ...f, label_en: `${f.label_en} (${c.code})` })));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.category_id) return setError('Choose a claim category.');
    if (!form.component_name.trim()) return setError('Give the component a name.');
    const rate = Number(form.rate_value);
    if (form.rate_value === '' || !Number.isFinite(rate) || rate < 0) return setError('The rate must be a number of zero or more.');
    const cap = form.cap_amount.trim() ? Number(form.cap_amount) : null;
    if (cap !== null && (!Number.isFinite(cap) || cap < 0)) return setError('The cap must be a number of zero or more.');
    if (form.unit_type === 'PER_UNIT' && !form.measure_key) return setError('Per-unit rules must name the work-log measure they count.');
    if (form.effective_end_date && form.effective_end_date < form.effective_start_date) return setError('The end date is before the start date.');
    const ok = await run(async () => {
      const payload = {
        category_id: Number(form.category_id),
        cadre_id: form.cadre_id ? Number(form.cadre_id) : null,
        region_id: form.region_id ? Number(form.region_id) : null,
        component_name: form.component_name.trim(),
        unit_type: form.unit_type,
        measure_key: form.unit_type === 'PER_UNIT' ? form.measure_key : null,
        rate_value: rate,
        currency: form.currency.trim() || 'TZS',
        cap_amount: cap,
        effective_start_date: form.effective_start_date,
        effective_end_date: form.effective_end_date || null,
      };
      if (initial) await api.put(`/admin/rate-rules/${initial.id}`, payload);
      else await api.post('/admin/rate-rules', payload);
      return true;
    });
    if (ok) onDone();
    return undefined;
  };

  return (
    <form className="stack" onSubmit={submit}>
      <p className="notice notice-info">
        Rates are active as soon as you save; no separate approval is required. Existing claims keep their recorded amounts.
      </p>
      <div className="grid-2">
        <Field label="Claim category *">
          <select value={form.category_id} onChange={set('category_id')} required>
            <option value="">Choose…</option>
            {lookups.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.is_active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cadre" hint="Leave blank to apply to every cadre">
          <select value={form.cadre_id} onChange={(e) => setForm((f) => ({ ...f, cadre_id: e.target.value, measure_key: '' }))}>
            <option value="">All cadres</option>
            {lookups.cadres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Region" hint="Leave blank to apply in every region">
          <select value={form.region_id} onChange={set('region_id')}>
            <option value="">All regions</option>
            {lookups.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Component name *" hint="Shown on the claim, e.g. Daily allowance">
          <input value={form.component_name} onChange={set('component_name')} required maxLength={255} />
        </Field>
        <Field label="Unit type *">
          <select value={form.unit_type} onChange={set('unit_type')}>
            {Object.entries(UNIT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        {form.unit_type === 'PER_UNIT' && (
          <Field label="Measure counted *" hint={cadre ? `Fields on the ${cadre.name} form` : 'Choose a cadre to see only its form fields'}>
            <select value={form.measure_key} onChange={set('measure_key')} required>
              <option value="">Choose…</option>
              {measureOptions.map((f, i) => (
                <option key={`${f.key}-${i}`} value={f.key}>
                  {f.label_en} — {f.key}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Rate *">
          <input type="number" min={0} step="any" inputMode="decimal" value={form.rate_value} onChange={set('rate_value')} required />
        </Field>
        <Field label="Currency">
          <input value={form.currency} onChange={set('currency')} maxLength={3} />
        </Field>
        <Field label="Cap amount" hint="Optional maximum for this component per claim">
          <input type="number" min={0} step="any" inputMode="decimal" value={form.cap_amount} onChange={set('cap_amount')} />
        </Field>
        <Field label="Effective from *">
          <input type="date" value={form.effective_start_date} onChange={set('effective_start_date')} required />
        </Field>
        <Field label="Effective until" hint="Leave blank for open-ended">
          <input type="date" value={form.effective_end_date} onChange={set('effective_end_date')} min={form.effective_start_date} />
        </Field>
      </div>
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save rate'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Dialog = { rule: RateRule };

export function RateRulesSection() {
  const { hasRole } = useAuth();
  const canManage = hasRole('FHI360_FINANCE', 'CSO_FINANCE');
  const { data, error, loading, reload } = useApi<RateRule[]>('/admin/rate-rules');
  const categories = useApi<ClaimCategory[]>('/admin/claim-categories');
  const cadres = useApi<Cadre[]>('/admin/cadres');
  const regions = useApi<Named[]>('/admin/regions');
  const [status, setStatus] = useState('ACTIVE');
  const [proposing, setProposing] = useState(false);
  const [editing, setEditing] = useState<RateRule | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deletion = useAction();

  const maps = useMemo(() => {
    const m = (rows: { id: number; name: string }[] | null) => new Map((rows || []).map((r) => [String(r.id), r.name]));
    return { category: m(categories.data), cadre: m(cadres.data), region: m(regions.data) };
  }, [categories.data, cadres.data, regions.data]);
  const lookupError = categories.error || cadres.error || regions.error;
  const lookups: Lookups | null =
    categories.data && cadres.data && regions.data ? { categories: categories.data, cadres: cadres.data, regions: regions.data } : null;

  const rows = (data || []).filter((r) => !status || r.status === status);
  const counts = (data || []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  const remove = async () => {
    if (!dialog) return;
    const result = await deletion.run(() => api.del<{ message: string }>(`/admin/rate-rules/${dialog.rule.id}`));
    if (result) {
      setDialog(null);
      setNotice(result.message);
      reload();
    }
  };

  return (
    <section className="card stack">
      <div className="section-head">
        <h3>Rate rules</h3>
        {canManage && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setNotice(null);
              setEditing(null);
              setProposing(true);
            }}
            disabled={!lookups}
          >
            Add rate
          </button>
        )}
      </div>
      <p className="notice notice-info">
        Saved rates are active immediately and apply within their effective dates. You can edit or delete rates. Existing claims keep their original calculation; deleting a used rate only removes it from future calculations.
      </p>
      <Alert kind="success">{notice}</Alert>
      <Alert>{lookupError}</Alert>
      <div className="filters">
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses ({data?.length ?? 0})</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)} ({counts[s] || 0})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <AsyncState data={data} error={error} loading={loading} empty="No rate rules yet.">
        {() =>
          rows.length === 0 ? (
            <p className="empty">No rules with this status.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Cadre</th>
                    <th>Region</th>
                    <th>Component</th>
                    <th>Unit</th>
                    <th>Measure</th>
                    <th className="num">Rate</th>
                    <th className="num">Cap</th>
                    <th>Effective</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    return (
                      <tr key={r.id}>
                        <td>{refName(maps.category, r.category_id)}</td>
                        <td>{r.cadre_id ? refName(maps.cadre, r.cadre_id) : <span className="muted">All cadres</span>}</td>
                        <td>{r.region_id ? refName(maps.region, r.region_id) : <span className="muted">All regions</span>}</td>
                        <td>{r.component_name}</td>
                        <td className="nowrap">{UNIT_TYPES[r.unit_type] || r.unit_type}</td>
                        <td>{r.measure_key ? <code>{r.measure_key}</code> : '—'}</td>
                        <td className="num nowrap">{money(r.rate_value, r.currency)}</td>
                        <td className="num nowrap">{r.cap_amount === null ? '—' : money(r.cap_amount, r.currency)}</td>
                        <td className="nowrap">
                          {dateOnly(r.effective_start_date)} – {r.effective_end_date ? dateOnly(r.effective_end_date) : 'open'}
                          {r.effective_end_date && r.effective_end_date < todayLocal() && <div className="muted small">Ended</div>}
                        </td>
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td>
                          <div className="row">
                            {canManage && r.status === 'ACTIVE' && (
                              <button className="btn btn-secondary btn-sm" disabled={!lookups} onClick={() => {
                                setEditing(r);
                                setProposing(true);
                                setNotice(null);
                              }}>Edit</button>
                            )}
                            {canManage ? (
                              <button className="btn btn-danger btn-sm" onClick={() => {
                                deletion.setError(null);
                                setDialog({ rule: r });
                              }}>Delete</button>
                            ) : <span className="muted">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncState>
      {proposing && lookups && (
        <Drawer title={editing ? 'Edit rate' : 'Add rate'} onClose={() => setProposing(false)} wide>
          <RateForm
            lookups={lookups}
            initial={editing || undefined}
            onCancel={() => setProposing(false)}
            onDone={() => {
              setProposing(false);
              setNotice('Rate saved and active. No separate approval is required.');
              reload();
            }}
          />
        </Drawer>
      )}
      {dialog && (
        <Modal
          title={`Delete “${dialog.rule.component_name}”`}
          onClose={() => setDialog(null)}
        >
          <p>This rate will no longer price new claims. Unused rates are permanently deleted. Rates already linked to claims are kept inactive for history; existing claim amounts do not change.</p>
          <Alert>{deletion.error}</Alert>
          <div className="row">
            <button className="btn btn-danger" disabled={deletion.busy} onClick={remove}>{deletion.busy ? 'Deleting…' : 'Delete rate'}</button>
            <button className="btn btn-ghost" disabled={deletion.busy} onClick={() => setDialog(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
