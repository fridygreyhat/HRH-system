import React, { useState } from 'react';
import { api, openBlob, saveBlob } from '../../api';
import { useAuth } from '../../AuthContext';
import {
  CLAIM_ACTION_LABELS,
  CLAIM_REASON_REQUIRED,
  DESTRUCTIVE_ACTIONS,
  dateOnly,
  dateTime,
  fileSize,
  humanize,
  label,
  money,
  num,
  PAYMENT_STATUS_LABELS,
  todayLocal,
} from '../../format';
import { useAction, useApi } from '../../hooks';
import { ClaimAudit, ClaimComponent, ClaimDetail, PaymentProof } from '../../types';
import { Alert, AuditTimeline, Drawer, Facts, Field, Modal, ReasonDialog, RouteBadge, Section, StatusBadge, Tabs } from '../ui';
import { ClaimTrace } from './ClaimTrace';

const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const PROOF_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export function ComponentsTable({ components, currency }: { components: ClaimComponent[]; currency: string }) {
  if (!components.length) return <p className="muted">No priced components.</p>;
  const total = components.reduce((s, c) => s + Number(c.amount), 0);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Unit</th>
            <th className="num">Units</th>
            <th className="num">Rate</th>
            <th className="num">Cap</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c, i) => (
            <tr key={c.id ?? `${c.component_name}-${i}`}>
              <td>{c.component_name}</td>
              <td>
                {humanize(c.unit_type)}
                {c.measure_key ? <div className="muted small">{c.measure_key}</div> : null}
              </td>
              <td className="num">{num(c.units)}</td>
              <td className="num">× {money(c.rate, currency)}</td>
              <td className="num">{c.cap_amount !== undefined && c.cap_amount !== null ? money(c.cap_amount, currency) : '—'}</td>
              <td className="num">= {money(c.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={5}>Total</th>
            <th className="num">{money(total, currency)}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function auditRows(rows: ClaimAudit[]) {
  return rows.map((a) => ({
    ...a,
    extra:
      a.old_payment_status !== a.new_payment_status && a.new_payment_status ? (
        <div className="row-inline small">
          {a.old_payment_status && <StatusBadge kind="payment" status={a.old_payment_status} />}
          {a.old_payment_status && <span aria-hidden>→</span>}
          <StatusBadge kind="payment" status={a.new_payment_status} />
        </div>
      ) : a.details && Object.keys(a.details).length ? (
        <div className="muted small">
          {Object.entries(a.details)
            .map(([k, v]) => `${humanize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(' · ')}
        </div>
      ) : null,
  }));
}

function RecordPaymentDialog({ claim, onDone, onClose }: { claim: ClaimDetail; onDone: (c: ClaimDetail) => void; onClose: () => void }) {
  const outstanding = Math.max(0, Number(claim.amount) - Number(claim.amount_paid));
  const [amount, setAmount] = useState(String(outstanding));
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayLocal());
  const [status, setStatus] = useState('PAID');
  const [method, setMethod] = useState('');
  const { busy, error, run } = useAction();
  const value = Number(amount);
  const tooMuch = status !== 'FAILED' && value > outstanding;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await run(() =>
      api.post<ClaimDetail>(`/claims/${claim.id}/payments`, {
        amount: value,
        payment_reference: reference.trim(),
        payment_date: paymentDate,
        status,
        payment_method: method.trim() || null,
      }),
    );
    if (result) onDone(result);
  };
  return (
    <Modal title={`Record payment – claim #${claim.id}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="notice notice-info">
          Record a payment that was made outside this system (bank or wallet). Outstanding: <strong>{money(outstanding, claim.currency)}</strong>.
        </p>
        <div className="grid-2">
          <Field label="Amount" hint={`At most ${money(outstanding, claim.currency)} for a paid/partial record`}>
            <input type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Result">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PAID">Paid (full or final instalment)</option>
              <option value="PARTIAL">Partial payment</option>
              <option value="FAILED">Failed attempt</option>
            </select>
          </Field>
          <Field label="Payment reference">
            <input required minLength={2} maxLength={255} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Payment date">
            <input type="date" required max={todayLocal()} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </Field>
          <Field label="Payment method (optional)" hint="HCP salaries must be paid into a bank account">
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Not specified</option>
              <option value="BANK">Bank account</option>
              <option value="MOBILE_WALLET">Mobile wallet</option>
            </select>
          </Field>
        </div>
        {tooMuch && <Alert kind="warn">The amount is more than the outstanding balance.</Alert>}
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || tooMuch || !(value > 0) || reference.trim().length < 2}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UploadProofDialog({ claim, onDone, onClose }: { claim: ClaimDetail; onDone: (c: ClaimDetail) => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [recordId, setRecordId] = useState('');
  const { busy, error, setError, run } = useAction();
  const choose = (f: File | null) => {
    setError(null);
    if (f && !PROOF_TYPES.includes(f.type)) setError('Proof must be a PDF, PNG or JPEG file.');
    else if (f && f.size > MAX_PROOF_BYTES) setError('The file is larger than 10 MB.');
    setFile(f);
  };
  const valid = !!file && PROOF_TYPES.includes(file.type) && file.size <= MAX_PROOF_BYTES;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !valid) return;
    const form = new FormData();
    form.append('file', file);
    if (recordId) form.append('payment_record_id', recordId);
    const result = await run(() => api.upload<ClaimDetail>(`/claims/${claim.id}/proofs`, form));
    if (result) onDone(result);
  };
  return (
    <Modal title={`Upload proof – claim #${claim.id}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="notice">
          Uploading proof does <strong>not</strong> mark the claim as paid. A payment must be recorded for the full amount, and if proof is added
          afterwards someone must use “Confirm paid”.
        </p>
        <Field label="Proof file (PDF, PNG or JPEG, up to 10 MB)">
          <input type="file" accept="application/pdf,image/png,image/jpeg" required onChange={(e) => choose(e.target.files?.[0] || null)} />
        </Field>
        {claim.payments.length > 0 && (
          <Field label="Link to payment record (optional)">
            <select value={recordId} onChange={(e) => setRecordId(e.target.value)}>
              <option value="">Not linked</option>
              {claim.payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.payment_reference} · {money(p.amount, claim.currency)} · {humanize(p.status)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !valid}>
            {busy ? 'Uploading…' : 'Upload proof'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Dialog = { kind: 'action'; action: string } | { kind: 'record_payment' } | { kind: 'upload_proof' } | null;

/** Claim detail drawer: components, budget line, exceptions, audit, workflow and payment actions (server-provided only). */
export function ClaimDrawer({ claimId, onClose, onChanged }: { claimId: number; onClose: () => void; onChanged?: () => void }) {
  const { hasRole } = useAuth();
  const isRpmWithoutFinanceRole = hasRole('RPM') && !hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE');
  const { data: claim, error, loading, setData } = useApi<ClaimDetail>(`/claims/${claimId}`);
  const canSeeBudgetDetails = hasRole('FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tab, setTab] = useState<'overview' | 'trace'>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const proofAction = useAction();

  const updated = (c: ClaimDetail, message: string) => {
    setData(c);
    setDialog(null);
    setNotice(message);
    onChanged?.();
  };

  const runAction = async (action: string, comment: string) => {
    const result = await api.post<ClaimDetail>(`/claims/${claimId}/actions/${action}`, { comment: comment || null });
    updated(result, `${CLAIM_ACTION_LABELS[action] || humanize(action)}: done.`);
  };

  const fetchProof = (proof: PaymentProof, open: boolean) =>
    proofAction.run(async () => {
      const file = await api.blob(`/claims/${claimId}/proofs/${proof.id}`, 'GET', proof.original_filename);
      if (open) openBlob(file);
      else saveBlob(file);
    });

  const outstanding = claim ? Math.max(0, Number(claim.amount) - Number(claim.amount_paid)) : 0;
  const paid = claim && (claim.payment_status === 'PAID' || claim.payment_status === 'RECONCILED');
  const financeReviewPending = claim?.status === 'PENDING_FINANCE_REVIEW';
  const paymentActions = claim && !isRpmWithoutFinanceRole && !financeReviewPending ? claim.payment_actions : [];
  const budget = claim && canSeeBudgetDetails && claim.budget_line && claim.budget_line.id === claim.budget_line_id
    ? claim.budget_line
    : undefined;
  const exposure = budget ? Number(budget.committed_amount || 0) + Number(budget.spent_amount || 0) : 0;
  const estimateReached = !!budget && budget.estimated_amount != null && exposure > 0 && exposure >= budget.estimated_amount;

  return (
    <Drawer title={`Claim #${claimId}`} onClose={onClose} wide>
      {error && <Alert>{error}</Alert>}
      {!claim && loading && <p className="muted">Loading…</p>}
      {claim && (
        <div className="stack-lg">
          <div className="stack">
            <div className="badges">
              <RouteBadge route={claim.route_code} />
              <StatusBadge kind="claim" status={claim.status} />
              <StatusBadge kind="payment" status={claim.payment_status} />
            </div>
            <div className="stats">
              <div className="stat card">
                <div className="stat-label">Claim amount</div>
                <div className="stat-value">{money(claim.amount, claim.currency)}</div>
              </div>
              <div className="stat card">
                <div className="stat-label">Payments recorded</div>
                <div className="stat-value">{money(claim.amount_paid, claim.currency)}</div>
                <div className="stat-hint">{paid ? label(PAYMENT_STATUS_LABELS, claim.payment_status) : 'Not marked paid'}</div>
              </div>
              <div className="stat card">
                <div className="stat-label">Outstanding</div>
                <div className="stat-value">{money(outstanding, claim.currency)}</div>
              </div>
            </div>
          </div>
          <Tabs
            label="Claim view"
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'overview', label: 'Overview & actions' },
              { key: 'trace', label: 'Trace to daily work' },
            ]}
          />
          {tab === 'trace' ? (
            <ClaimTrace claimId={claimId} />
          ) : (
            <>
          {claim.exception_reason && (
            <div className="alert alert-warn" role="status">
              <strong>Exception – needs attention:</strong> {claim.exception_reason}
            </div>
          )}
          <Alert kind="success">{notice}</Alert>
          {estimateReached && budget && (
            <Alert kind="warn">
              Soft estimate reached for {budget.code}: {money(exposure, claim.currency)} exposure of {money(budget.estimated_amount!, claim.currency)} estimated. This is a planning warning only; it does not change claim actions or the hard-cap approval rule.
            </Alert>
          )}
          {financeReviewPending && (
            <p className="notice notice-info">
              This claim was created from the RM-approved work log’s saved activity rates. It is awaiting Regional Finance review and category selection. The amount is not routed, budget-committed or payable; finance will review this same claim before routing.
            </p>
          )}
          {claim.payment_recipient && (
            <Section title="Payment recipient · CSO verification">
              <Facts items={[
                ['Recipient', claim.payment_recipient.name],
                ['Payment method', claim.payment_recipient.payment_method],
                ['Provider', claim.payment_recipient.payment_provider],
                ['Account', claim.payment_recipient.payment_account],
                ...(claim.payment_recipient.bank_branch ? [['Bank branch', claim.payment_recipient.bank_branch] as [string, React.ReactNode]] : []),
              ]} />
            </Section>
          )}

          {claim.available_actions.length > 0 && (
            <Section title="Claim actions">
              <div className="row">
                {claim.available_actions.filter((a) => !financeReviewPending || !['mark_ready', 'export'].includes(a)).map((a) => (
                  <button
                    key={a}
                    className={`btn ${DESTRUCTIVE_ACTIONS.has(a) ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={() => setDialog({ kind: 'action', action: a })}
                  >
                    {CLAIM_ACTION_LABELS[a] || humanize(a)}
                  </button>
                ))}
              </div>
              <p className="muted small">Each claim is decided individually. Approval must be by a different person from the preparer.</p>
            </Section>
          )}

          <Section title="Details">
            <Facts
              items={[
                ['Staff', claim.staff_name],
                ['Category', claim.category_name || (claim.category_id == null ? 'Not selected yet' : `Category #${claim.category_id}`)],
                ['Period', claim.period_label],
                ['Payor', claim.payor_name],
                ['Executor (pays)', claim.executor_name],
                ['Budget line', claim.budget_line ? `${claim.budget_line.code} – ${claim.budget_line.name}` : 'Not resolved'],
                ['Origin', humanize(claim.origin_channel)],
                ['Work log', claim.work_log_id ? `#${claim.work_log_id}` : 'None (community claim)'],
                ['Batch', claim.batch_reference],
                ['Created', dateTime(claim.created_at)],
                ['Community verified', claim.verified_at ? dateTime(claim.verified_at) : null],
                ['Approved', claim.approved_at ? dateTime(claim.approved_at) : null],
              ]}
            />
            {(claim.description || claim.evidence_text) && (
              <div>
                <div className="field-label">{claim.work_type === 'COMMUNITY' ? 'Description' : 'Evidence'}</div>
                <p className="timeline-comment">{claim.description || claim.evidence_text}</p>
              </div>
            )}
            {claim.declared_units && Object.keys(claim.declared_units).length > 0 && (
              <div>
                <div className="field-label">Declared units</div>
                <p className="timeline-comment">
                  {Object.entries(claim.declared_units)
                    .map(([k, v]) => `${humanize(k)}: ${num(v)}`)
                    .join(' · ')}
                </p>
              </div>
            )}
          </Section>

          <Section title="Calculation">
            <ComponentsTable components={claim.components} currency={claim.currency} />
            {claim.calculation_snapshot ? (
              <p className="muted small">
                Authorized calculation frozen at approval ({dateTime(claim.calculation_snapshot.authorized_at)}): route {claim.calculation_snapshot.route},{' '}
                {money(claim.calculation_snapshot.amount, claim.currency)}. Later rate changes do not alter it.
              </p>
            ) : (
              <p className="muted small">Not yet approved: the amount is recalculated from active rate rules until approval.</p>
            )}
          </Section>

          {(claim.payments.length > 0 || claim.proofs.length > 0 || paymentActions.length > 0) && (
            <Section
              title="Payment"
              actions={paymentActions.map((a) => (
                <button
                  key={a}
                  className={`btn btn-sm ${a === 'record_payment' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDialog(a === 'record_payment' || a === 'upload_proof' ? { kind: a } : { kind: 'action', action: a })}
                >
                  {CLAIM_ACTION_LABELS[a] || humanize(a)}
                </button>
              ))}
            >
              <p className="notice notice-info small">
                Payments are made outside this system and recorded here. Uploading proof alone does not mark a payment as paid; a claim is “Paid” only
                when payments for the full amount are recorded with the required proof.
              </p>
              {claim.payments.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Date</th>
                        <th>Method</th>
                        <th>Result</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claim.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.payment_reference}</td>
                          <td>{dateOnly(p.payment_date)}</td>
                          <td>{p.payment_method || '—'}</td>
                          <td>
                            <StatusBadge status={p.status} />
                          </td>
                          <td className="num">{money(p.amount, claim.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">No payments recorded.</p>
              )}
              <h3>Proof of payment</h3>
              {claim.proofs.length ? (
                <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {claim.proofs.map((p) => (
                    <li key={p.id} className="row-between">
                      <span>
                        {p.original_filename} <span className="muted small">({fileSize(p.size_bytes)}{p.created_at ? `, ${dateTime(p.created_at)}` : ''})</span>
                      </span>
                      <span className="row">
                        <button className="btn btn-secondary btn-sm" disabled={proofAction.busy} onClick={() => fetchProof(p, true)}>
                          Open
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={proofAction.busy} onClick={() => fetchProof(p, false)}>
                          Download
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No proof uploaded.</p>
              )}
              <Alert>{proofAction.error}</Alert>
            </Section>
          )}

          <Section title="History">
            <AuditTimeline rows={auditRows(claim.audit)} actionLabels={CLAIM_ACTION_LABELS} statusKind="claim" />
          </Section>
            </>
          )}
        </div>
      )}

      {claim && dialog?.kind === 'action' && (
        <ReasonDialog
          title={CLAIM_ACTION_LABELS[dialog.action] || humanize(dialog.action)}
          required={CLAIM_REASON_REQUIRED.has(dialog.action)}
          danger={DESTRUCTIVE_ACTIONS.has(dialog.action)}
          confirmLabel={CLAIM_ACTION_LABELS[dialog.action] || humanize(dialog.action)}
          description={actionHelp(dialog.action, claim)}
          onConfirm={(comment) => runAction(dialog.action, comment)}
          onClose={() => setDialog(null)}
        />
      )}
      {claim && dialog?.kind === 'record_payment' && (
        <RecordPaymentDialog claim={claim} onClose={() => setDialog(null)} onDone={(c) => updated(c, 'Payment recorded.')} />
      )}
      {claim && dialog?.kind === 'upload_proof' && (
        <UploadProofDialog claim={claim} onClose={() => setDialog(null)} onDone={(c) => updated(c, 'Proof uploaded. This does not by itself mark the claim paid.')} />
      )}
    </Drawer>
  );
}

function actionHelp(action: string, claim: ClaimDetail): string {
  switch (action) {
    case 'approve':
      return `Approving commits ${money(claim.amount, claim.currency)} against the budget line. If the line is short the claim is held.`;
    case 'send_back':
      return 'The claim returns to “Validation needed” with your reason shown as its exception.';
    case 'cancel':
      return 'Cancelling releases any committed budget. This cannot be undone.';
    case 'confirm_paid':
      return 'Confirm that the recorded payments and uploaded proof cover the full amount.';
    case 'reconcile':
      return 'Reconciliation must be done by someone other than the person who recorded the payment.';
    case 'verify_community':
      return 'Confirm that the community service described in the evidence took place.';
    case 'mark_ready':
      return 'The claim will be included in the next payroll batch for its route.';
    case 'revalidate':
      return 'Recalculate the route, budget line and amount from the current configuration.';
    default:
      return '';
  }
}
