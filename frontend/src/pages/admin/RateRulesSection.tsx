import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, dateTime, humanize, money, todayLocal } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Cadre, ClaimCategory, Named, RateRule } from '../../types';
import { Alert, AsyncState, Drawer, Field, ReasonDialog, StatusBadge } from '../../components/ui';
import { refName } from './common';

const UNIT_TYPES: Record<RateRule['unit_type'], string> = {
  PER_DAY: 'Per day worked',
  PER_HOUR: 'Per hour worked',
  PER_UNIT: 'Per unit of a work-log measure',
  FIXED: 'Fixed amount',
};
const STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED', 'RETIRED'];

interface Lookups {
  categories: ClaimCategory[];
  cadres: Cadre[];
  regions: Named[];
}

function ProposeForm({ lookups, onDone, onCancel }: { lookups: Lookups; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    category_id: '',
    cadre_id: '',
    region_id: '',
    component_name: '',
    unit_type: 'PER_DAY' as RateRule['unit_type'],
    measure_key: '',
    rate_value: '',
    currency: 'TZS',
    cap_amount: '',
    effective_start_date: todayLocal(),
    effective_end_date: '',
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
      await api.post('/admin/rate-rules', {
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
      });
      return true;
    });
    if (ok) onDone();
    return undefined;
  };

  return (
    <form className="stack" onSubmit={submit}>
      <p className="notice notice-info">
        Your proposal stays inactive until an RM or Oversight user other than you approves it. Only ACTIVE rules price claims.
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
          {busy ? 'Submitting…' : 'Propose rule'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Dialog = { kind: 'approve' | 'reject' | 'retire'; rule: RateRule };

export function RateRulesSection() {
  const { me, hasRole } = useAuth();
  const canPropose = hasRole('FHI360_FINANCE', 'CSO_FINANCE');
  const canDecide = hasRole('RPM', 'OVERSIGHT');
  const { data, error, loading, reload } = useApi<RateRule[]>('/admin/rate-rules');
  const categories = useApi<ClaimCategory[]>('/admin/claim-categories');
  const cadres = useApi<Cadre[]>('/admin/cadres');
  const regions = useApi<Named[]>('/admin/regions');
  const [status, setStatus] = useState('');
  const [proposing, setProposing] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [retireDate, setRetireDate] = useState(todayLocal());
  const [notice, setNotice] = useState<string | null>(null);

  const maps = useMemo(() => {
    const m = (rows: { id: number; name: string }[] | null) => new Map((rows || []).map((r) => [String(r.id), r.name]));
    return { category: m(categories.data), cadre: m(cadres.data), region: m(regions.data) };
  }, [categories.data, cadres.data, regions.data]);
  const lookupError = categories.error || cadres.error || regions.error;
  const lookups: Lookups | null =
    categories.data && cadres.data && regions.data ? { categories: categories.data, cadres: cadres.data, regions: regions.data } : null;

  const rows = (data || []).filter((r) => !status || r.status === status);
  const counts = (data || []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  const decide = async (comment: string) => {
    if (!dialog) return;
    const { kind, rule } = dialog;
    if (kind === 'retire') {
      if (!retireDate) throw new Error('Choose the last day the rule applies.');
      if (comment.length < 3) throw new Error('Give a reason (at least 3 characters).');
      await api.post(`/admin/rate-rules/${rule.id}/retire`, { effective_end_date: retireDate, reason: comment });
    } else {
      await api.post(`/admin/rate-rules/${rule.id}/${kind}`, { comment: comment || null });
    }
    setDialog(null);
    setNotice(kind === 'approve' ? 'Rule approved and now active.' : kind === 'reject' ? 'Rule rejected.' : 'Rule end-dated.');
    reload();
  };

  return (
    <section className="card stack">
      <div className="section-head">
        <h3>Rate rules</h3>
        {canPropose && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setNotice(null);
              setProposing(true);
            }}
            disabled={!lookups}
          >
            Propose a rule
          </button>
        )}
      </div>
      <p className="notice notice-info">
        Only ACTIVE rules are used to price claims. Proposed rules are inactive until approved by an RM or Oversight user other than the proposer.
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
                    const mine = r.created_by === me?.id;
                    const showDecide = canDecide && r.status === 'PENDING_APPROVAL' && !mine;
                    const showRetire = canPropose && r.status === 'ACTIVE';
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
                          {r.approved_at && (
                            <div className="muted small">
                              {r.status === 'REJECTED' ? 'Rejected' : 'Approved'} {dateTime(r.approved_at)}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="row">
                            {showDecide && (
                              <>
                                <button className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'approve', rule: r })}>
                                  Approve
                                </button>
                                <button className="btn btn-danger btn-sm" onClick={() => setDialog({ kind: 'reject', rule: r })}>
                                  Reject
                                </button>
                              </>
                            )}
                            {canDecide && r.status === 'PENDING_APPROVAL' && mine && <span className="muted small">Your proposal</span>}
                            {showRetire && (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                  setRetireDate(todayLocal());
                                  setDialog({ kind: 'retire', rule: r });
                                }}
                              >
                                Retire
                              </button>
                            )}
                            {!showDecide && !showRetire && !(canDecide && mine && r.status === 'PENDING_APPROVAL') && <span className="muted">—</span>}
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
        <Drawer title="Propose a rate rule" onClose={() => setProposing(false)} wide>
          <ProposeForm
            lookups={lookups}
            onCancel={() => setProposing(false)}
            onDone={() => {
              setProposing(false);
              setNotice('Rule proposed. It is inactive until an RM or Oversight user approves it.');
              reload();
            }}
          />
        </Drawer>
      )}
      {dialog && (
        <ReasonDialog
          title={
            dialog.kind === 'approve'
              ? `Approve “${dialog.rule.component_name}”`
              : dialog.kind === 'reject'
                ? `Reject “${dialog.rule.component_name}”`
                : `Retire “${dialog.rule.component_name}”`
          }
          description={
            dialog.kind === 'approve'
              ? `Once approved, this rule prices claims in ${refName(maps.category, dialog.rule.category_id)} from ${dateOnly(dialog.rule.effective_start_date)}: ${money(dialog.rule.rate_value, dialog.rule.currency)} ${UNIT_TYPES[dialog.rule.unit_type].toLowerCase()}.`
              : dialog.kind === 'reject'
                ? 'The proposal will not be used. The proposer can submit a corrected rule.'
                : 'The rule stops applying after the chosen date. Claims already authorized keep their calculation.'
          }
          required={dialog.kind !== 'approve'}
          confirmLabel={dialog.kind === 'approve' ? 'Approve rule' : dialog.kind === 'reject' ? 'Reject rule' : 'Retire rule'}
          danger={dialog.kind !== 'approve'}
          onConfirm={decide}
          onClose={() => setDialog(null)}
        >
          {dialog.kind === 'retire' && (
            <Field label="Last day the rule applies *">
              <input type="date" value={retireDate} min={dialog.rule.effective_start_date} onChange={(e) => setRetireDate(e.target.value)} required />
            </Field>
          )}
        </ReasonDialog>
      )}
    </section>
  );
}
