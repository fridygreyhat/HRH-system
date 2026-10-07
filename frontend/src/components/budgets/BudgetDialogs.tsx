import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { useAction } from '../../hooks';
import { money } from '../../format';
import { BudgetLine, ClaimCategory, Named, Organization, PayPeriod } from '../../types';
import { Alert, Field, Modal } from '../ui';

const periodName = (p: PayPeriod) => p.period_label || `${p.start_date} – ${p.end_date}`;

export function CreateLineModal({
  organizations,
  categories,
  periods,
  regions,
  onClose,
  onCreated,
}: {
  organizations: Organization[];
  categories: ClaimCategory[];
  periods: PayPeriod[];
  regions: Named[];
  onClose: () => void;
  onCreated: (line: BudgetLine) => void;
}) {
  const [form, setForm] = useState({
    code: '',
    name: '',
    organization_id: organizations.length === 1 ? String(organizations[0].id) : '',
    category_id: '',
    period_id: periods[0] ? String(periods[0].id) : '',
    region_id: '',
    allocated_amount: '',
    currency: 'TZS',
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const line = await run(() =>
      api.post<BudgetLine>('/budgets/lines', {
        code: form.code.trim(),
        name: form.name.trim(),
        organization_id: Number(form.organization_id),
        category_id: Number(form.category_id),
        period_id: Number(form.period_id),
        region_id: form.region_id ? Number(form.region_id) : null,
        allocated_amount: Number(form.allocated_amount),
        currency: form.currency.trim().toUpperCase() || 'TZS',
      }),
    );
    if (line) onCreated(line);
  };

  return (
    <Modal title="New budget line" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Code">
            <input value={form.code} onChange={set('code')} required maxLength={100} />
          </Field>
          <Field label="Name">
            <input value={form.name} onChange={set('name')} required maxLength={255} />
          </Field>
          <Field label="Organization">
            <select value={form.organization_id} onChange={set('organization_id')} required>
              <option value="">Select…</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Claim category">
            <select value={form.category_id} onChange={set('category_id')} required>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pay period">
            <select value={form.period_id} onChange={set('period_id')} required>
              <option value="">Select…</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodName(p)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Region" hint="Leave as “All regions” for a line that covers every region.">
            <select value={form.region_id} onChange={set('region_id')}>
              <option value="">All regions</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Allocated amount">
            <input type="number" min={0} step="0.01" inputMode="decimal" value={form.allocated_amount} onChange={set('allocated_amount')} required />
          </Field>
          <Field label="Currency">
            <input value={form.currency} onChange={set('currency')} required maxLength={3} />
          </Field>
        </div>
        <p className="muted small">FHI360 lines start as “Unsynced” until they are exported to or reconciled with the HQ tracker.</p>
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Create line'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ReallocateModal({
  lines,
  sources,
  initialFrom,
  onClose,
  onDone,
}: {
  /** All visible lines (possible targets). */
  lines: BudgetLine[];
  /** Lines the user may move money out of. */
  sources: BudgetLine[];
  initialFrom?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fromId, setFromId] = useState(initialFrom ? String(initialFrom) : '');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const source = sources.find((l) => String(l.id) === fromId) || null;
  const targets = useMemo(
    () => (source ? lines.filter((l) => l.id !== source.id && l.organization_id === source.organization_id && l.currency === source.currency) : []),
    [lines, source],
  );
  const tooMuch = !!source && Number(amount) > source.available_amount;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() =>
      api.post('/budgets/reallocate', { from_line_id: Number(fromId), to_line_id: Number(toId), amount: Number(amount), reason: reason.trim() }),
    );
    if (ok) onDone();
  };

  const lineName = (l: BudgetLine) => `${l.code} · ${l.name} (${l.period_label}, ${l.region_name})`;

  return (
    <Modal title="Reallocate budget" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">Money can only move between lines of the same organization and currency, and only from the uncommitted balance.</p>
        <Field label="From line">
          <select
            value={fromId}
            onChange={(e) => {
              setFromId(e.target.value);
              setToId('');
            }}
            required
          >
            <option value="">Select…</option>
            {sources.map((l) => (
              <option key={l.id} value={l.id}>
                {lineName(l)}
              </option>
            ))}
          </select>
        </Field>
        {source && (
          <p className="small">
            Available on {source.code}: <strong>{money(source.available_amount, source.currency)}</strong> ({source.organization_name})
          </p>
        )}
        <Field label="To line" hint={source && !targets.length ? 'No other line of this organization and currency is visible.' : undefined}>
          <select value={toId} onChange={(e) => setToId(e.target.value)} required disabled={!source}>
            <option value="">Select…</option>
            {targets.map((l) => (
              <option key={l.id} value={l.id}>
                {lineName(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Amount${source ? ` (${source.currency})` : ''}`} hint={tooMuch ? 'More than the available balance.' : undefined}>
          <input type="number" min={0.01} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Reason (required)">
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={1000} />
        </Field>
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || tooMuch || !fromId || !toId || reason.trim().length < 3}>
            {busy ? 'Moving…' : 'Reallocate'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ReconcileModal({ line, onClose, onDone }: { line: BudgetLine; onClose: () => void; onDone: (line: BudgetLine) => void }) {
  const [ref, setRef] = useState(line.external_ref || '');
  const [comment, setComment] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await run(() =>
      api.post<BudgetLine>(`/budgets/lines/${line.id}/reconcile`, { external_ref: ref.trim() || null, comment: comment.trim() }),
    );
    if (updated) onDone(updated);
  };
  return (
    <Modal title={`Reconcile ${line.code} with the HQ tracker`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">
          Confirm that this line matches the FHI360 HQ tracker (checked manually — there is no live connection). The line is marked “Reconciled”.
        </p>
        <Field label="Tracker reference" hint="Optional; keeps the current reference when left blank.">
          <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={255} />
        </Field>
        <Field label="Comment (required, at least 3 characters)">
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required minLength={3} maxLength={1000} />
        </Field>
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || comment.trim().length < 3}>
            {busy ? 'Saving…' : 'Mark reconciled'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
