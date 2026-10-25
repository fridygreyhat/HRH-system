import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { useAction, useApi } from '../../hooks';
import { money } from '../../format';
import { BudgetLine, ClaimCategory, Named, Organization, OrganizationsResponse, PayPeriod } from '../../types';
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
    period_id: periods.find((period) => period.region_id == null) ? String(periods.find((period) => period.region_id == null)!.id) : '',
    region_id: '',
    allocated_amount: '',
    currency: 'TZS',
  });
  const mappingData = useApi<OrganizationsResponse>('/organizations');
  const { busy, error, setError, run } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const selectedOrg = organizations.find((organization) => String(organization.id) === form.organization_id);
  const isCsoBudget = selectedOrg?.type === 'CSO';
  const existingLines = useApi<BudgetLine[]>('/budgets/lines');
  const mappedRegionIds = new Set((mappingData.data?.assignments || [])
    .filter((assignment) => assignment.organization_id === Number(form.organization_id) && assignment.is_active)
    .map((assignment) => assignment.region_id));
  const accessibleRegionIds = new Set((mappingData.data?.regions || []).map((region) => region.id));
  const allowedRegions = isCsoBudget
    ? regions.filter((region) => mappedRegionIds.has(region.id) && accessibleRegionIds.has(region.id))
    : regions;
  const allowedPeriods = periods.filter((period) => period.region_id == null || (!!form.region_id && period.region_id === Number(form.region_id)));
  const selectedPeriod = periods.find((period) => String(period.id) === form.period_id);
  const periodRegionMismatch = !!selectedPeriod && selectedPeriod.region_id != null && selectedPeriod.region_id !== Number(form.region_id);
  const existingBucket = isCsoBudget && form.organization_id && form.region_id && form.category_id && form.period_id
    ? (existingLines.data || []).find((line) =>
        line.organization_id === Number(form.organization_id) &&
        line.region_id === Number(form.region_id) &&
        line.category_id === Number(form.category_id) &&
        line.period_id === Number(form.period_id))
    : undefined;
  const setOrganization = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setForm({ ...form, organization_id: event.target.value, region_id: '', period_id: '' });
  };
  const setRegion = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const region_id = event.target.value;
    const nextPeriods = periods.filter((period) => period.region_id == null || (!!region_id && period.region_id === Number(region_id)));
    setForm({ ...form, region_id, period_id: nextPeriods[0] ? String(nextPeriods[0].id) : '' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (periodRegionMismatch) {
      setError('Choose a global pay period or one assigned to the selected region.');
      return;
    }
    if (isCsoBudget && (existingLines.loading || !existingLines.data || existingBucket)) {
      setError(existingBucket ? 'A CSO budget already exists for this organization, region, category, and pay period.' : 'Existing CSO budget lines could not be checked. Retry before creating a line.');
      return;
    }
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
            <select value={form.organization_id} onChange={setOrganization} required>
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
          <Field label="Pay period" hint="Choose a global schedule or a regional schedule matching the selected region.">
            <select value={form.period_id} onChange={set('period_id')} required>
              <option value="">Select…</option>
              {allowedPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodName(p)}{p.region_id == null ? ' · Global' : p.region_name ? ` · ${p.region_name}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Region" hint={isCsoBudget ? 'Choose an active CSO-region assignment. CSO budgets cannot cover all regions.' : 'Leave as “All regions” for a line that covers every region.'}>
            <select value={form.region_id} onChange={setRegion} required={isCsoBudget}>
              {isCsoBudget
                ? <option value="">Choose an assigned region…</option>
                : <option value="">All regions</option>}
              {allowedRegions.map((r) => (
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
        <p className="muted small">FHI360 lines start as “Unsynced” until they are exported to or reconciled with the HQ tracker. Historical all-region lines remain visible but cannot be used for new CSO budgets.</p>
        {isCsoBudget && !mappingData.loading && allowedRegions.length === 0 && <Alert>No active regional assignment is configured for this organization. Add an assignment before creating a CSO budget.</Alert>}
        {periodRegionMismatch && <Alert>That regional pay period does not match the selected budget region.</Alert>}
        {existingBucket && <Alert>A CSO budget already exists for this organization, region, category, and pay period. Change the bucket rather than creating a duplicate.</Alert>}
        <Alert>{mappingData.error || (isCsoBudget ? existingLines.error : null) || error}</Alert>
        {isCsoBudget && existingLines.error && <button type="button" className="btn btn-secondary btn-sm" onClick={existingLines.reload}>Retry budget check</button>}
        <div className="row">
          <button className="btn btn-primary" disabled={busy || periodRegionMismatch || !!existingBucket || (isCsoBudget && (mappingData.loading || existingLines.loading || !existingLines.data || !form.region_id || !mappedRegionIds.has(Number(form.region_id))))}>
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
  fhiOrgIds,
  initialFrom,
  onClose,
  onDone,
}: {
  /** All visible lines (possible targets). */
  lines: BudgetLine[];
  /** Lines the user may move money out of. */
  sources: BudgetLine[];
  fhiOrgIds: Set<number>;
  initialFrom?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fromId, setFromId] = useState(initialFrom ? String(initialFrom) : '');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const mappingData = useApi<OrganizationsResponse>('/organizations');
  const { busy, error, run } = useAction();
  const source = sources.find((l) => String(l.id) === fromId) || null;
  const targets = useMemo(
    () => (source ? lines.filter((l) => {
      if (l.id === source.id || l.organization_id !== source.organization_id || l.currency !== source.currency) return false;
      if (fhiOrgIds.has(l.organization_id)) return true;
      const organization = mappingData.data?.organizations.find((org) => org.id === l.organization_id);
      if (organization?.type === 'FHI360') return true;
      return l.region_id != null && !!mappingData.data?.assignments.some((assignment) => assignment.organization_id === l.organization_id && assignment.region_id === l.region_id && assignment.is_active);
    }) : []),
    [lines, source, mappingData.data, fhiOrgIds],
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
        <Alert>{mappingData.error || error}</Alert>
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
