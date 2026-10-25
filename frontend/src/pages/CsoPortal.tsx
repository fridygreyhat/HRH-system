import React, { useEffect, useState } from 'react';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { PAYMENT_STATUS_LABELS, ageSince, dateTime, label, money, num } from '../format';
import { useAction, useApi } from '../hooks';
import { Batch, BudgetLine, CsoFinanceOrganization, ClaimSummary, PayPeriod } from '../types';
import { ClaimDrawer } from '../components/claims/ClaimDrawer';
import { BatchDrawer } from '../components/batches/BatchDrawer';
import { BudgetHierarchy } from '../components/budgets/BudgetHierarchy';
import { Alert, AsyncState, Empty, Field, RouteBadge, Section, StatTile, StatusBadge } from '../components/ui';

type SectionKey = 'all' | 'pending' | 'receipt' | 'routec' | 'recon' | 'budget' | 'export';

const PENDING_STATUSES = ['PENDING', 'PARTIALLY_RECORDED', 'PROOF_REQUIRED', 'FAILED'];
const NEXT_ACTION: Record<string, string> = {
  NOT_STARTED: 'Record payment',
  PENDING: 'Record payment',
  PARTIALLY_RECORDED: 'Record remaining payment',
  PROOF_REQUIRED: 'Upload proof, then confirm paid',
  FAILED: 'Record a new payment attempt',
};
const RECON_GROUPS: { status: string; title: string }[] = [
  { status: 'NOT_STARTED', title: 'Ready for payment' },
  { status: 'PENDING', title: 'Unpaid' },
  { status: 'PARTIALLY_RECORDED', title: 'Partially recorded' },
  { status: 'PROOF_REQUIRED', title: 'Proof missing' },
  { status: 'FAILED', title: 'Failed' },
  { status: 'PAID', title: 'Paid' },
  { status: 'RECONCILED', title: 'Reconciled' },
];
const ROUTE_C_GROUPS: { status: string; title: string; hint: string }[] = [
  { status: 'VALIDATION_NEEDED', title: 'Returned for correction', hint: 'The provider can update and resubmit this claim.' },
  { status: 'BUDGET_HOLD', title: 'Budget hold', hint: 'Review the budget hold and release it when the allocation is available.' },
  { status: 'DRAFT', title: 'Drafts', hint: 'The provider has not submitted this claim.' },
  {
    status: 'AWAITING_APPROVAL',
    title: 'Awaiting approval',
    hint: 'Independently approve after community verification. Approval commits budget; it does not record payment.',
  },
  {
    status: 'PENDING_COMMUNITY_VERIFICATION',
    title: 'Awaiting community verification',
    hint: 'A scoped community verifier must confirm service delivery before CSO approval.',
  },
  { status: 'APPROVED', title: 'Approved · payment to record', hint: 'Pay externally, then record the disbursement and attach proof here. No export batch is required.' },
];

const outstanding = (c: ClaimSummary) => Math.max(0, Number(c.amount) - Number(c.amount_paid || 0));
const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;
const sum = (rows: ClaimSummary[], f: (c: ClaimSummary) => number) => rows.reduce((s, c) => s + f(c), 0);

function openOnKey(e: React.KeyboardEvent, open: () => void) {
  if (e.key === 'Enter') open();
}

function PendingTable({ rows, onOpen }: { rows: ClaimSummary[]; onOpen: (id: number) => void }) {
  return (
    <div className="table-wrap">
      <table className="table clickable">
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Staff</th>
            <th scope="col">Category / period</th>
            <th scope="col">Payment</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col" className="num">
              Paid
            </th>
            <th scope="col" className="num">
              Outstanding
            </th>
            <th scope="col">Next action</th>
            <th scope="col">Waiting</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const late = hoursSince(c.updated_at) > 48;
            return (
              <tr
                key={c.id}
                className={late ? 'row-over-48' : undefined}
                tabIndex={0}
                onClick={() => onOpen(c.id)}
                onKeyDown={(e) => openOnKey(e, () => onOpen(c.id))}
                aria-label={`Open claim ${c.id}`}
              >
                <td>#{c.id}</td>
                <td>{c.staff_name}</td>
                <td>
                  {c.category_name}
                  <div className="muted small">{c.period_label}</div>
                  {c.workflow_version === 2 && c.work_type && <span className="badge badge-neutral">{c.work_type}</span>}
                </td>
                <td>
                  <RouteBadge route={c.route_code} />
                </td>
                <td>
                  <div className="badges">
                    <StatusBadge status={c.status} kind="claim" />
                    <StatusBadge status={c.payment_status} kind="payment" />
                  </div>
                  {c.exception_reason && <div className="small over-48">{c.exception_reason}</div>}
                </td>
                <td className="num nowrap">{money(c.amount, c.currency)}</td>
                <td className="num nowrap">{money(c.amount_paid, c.currency)}</td>
                <td className="num nowrap">
                  <strong>{money(outstanding(c), c.currency)}</strong>
                </td>
                <td>
                  <strong>{NEXT_ACTION[c.payment_status] || '—'}</strong>
                </td>
                <td className={`nowrap${late ? ' over-48' : ''}`} title={`Last updated ${dateTime(c.updated_at)}`}>
                  {ageSince(c.updated_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClaimList({ rows, onOpen, meId }: { rows: ClaimSummary[]; onOpen: (id: number) => void; meId?: number }) {
  return (
    <div className="table-wrap">
      <table className="table clickable">
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Staff</th>
            <th scope="col">Category / period</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col" className="num">
              Paid
            </th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.id}
              tabIndex={0}
              onClick={() => onOpen(c.id)}
              onKeyDown={(e) => openOnKey(e, () => onOpen(c.id))}
              aria-label={`Open claim ${c.id}`}
            >
              <td>
                #{c.id} <RouteBadge route={c.route_code} />
              </td>
              <td>{c.staff_name}</td>
              <td>
                {c.category_name}
                <div className="muted small">{c.period_label}</div>
                {c.workflow_version === 2 && c.work_type && <span className="badge badge-neutral">{c.work_type}</span>}
              </td>
              <td>
                <div className="badges">
                  <StatusBadge status={c.status} kind="claim" />
                  <StatusBadge status={c.payment_status} kind="payment" />
                </div>
                {c.exception_reason && (
                  <div className="small">
                    <strong className="over-48">Exception:</strong> {c.exception_reason}
                  </div>
                )}
                {meId !== undefined && c.status === 'AWAITING_APPROVAL' && c.created_by === meId && (
                  <div className="small muted">You prepared this claim, so a colleague must approve it.</div>
                )}
              </td>
              <td className="num nowrap">{money(c.amount, c.currency)}</td>
              <td className="num nowrap">{money(c.amount_paid, c.currency)}</td>
              <td className="nowrap small">{dateTime(c.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CsoPortal() {
  const { me } = useAuth();
  const claims = useApi<ClaimSummary[]>('/claims');
  const batches = useApi<Batch[]>('/batches');
  const budgets = useApi<BudgetLine[]>('/budgets/lines');
  const payPeriods = useApi<PayPeriod[]>('/cso-finance/pay-periods');
  const organizations = useApi<CsoFinanceOrganization[]>('/cso-finance/organizations');
  const receive = useAction();
  const payrollExport = useAction();
  const [section, setSection] = useState<SectionKey>('all');
  const [claimId, setClaimId] = useState<number | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [selectedCsoId, setSelectedCsoId] = useState('');

  useEffect(() => {
    if (payPeriods.data?.length && !payPeriods.data.some((period) => String(period.id) === selectedPeriodId)) {
      setSelectedPeriodId(String(payPeriods.data[0].id));
    }
  }, [payPeriods.data, selectedPeriodId]);
  useEffect(() => {
    if (organizations.data?.length && !organizations.data.some((organization) => String(organization.id) === selectedCsoId)) {
      setSelectedCsoId(String(organizations.data[0].id));
    }
  }, [organizations.data, selectedCsoId]);

  const csoNames = (me?.organizations || []).filter((o) => o.type === 'CSO').map((o) => o.name);
  const csoOrgIds = new Set((me?.organizations || []).filter((organization) => organization.type === 'CSO').map((organization) => organization.id));
  const csoBudgetLines = (budgets.data || []).filter((line) => csoOrgIds.has(line.organization_id));
  const names = csoNames.length ? csoNames : (me?.organizations || []).map((o) => o.name);

  const refreshAll = () => {
    claims.reload();
    batches.reload();
    budgets.reload();
    payPeriods.reload();
    organizations.reload();
  };

  const all = claims.data || [];
  const isDirectV2Ready = (claim: ClaimSummary) => claim.workflow_version === 2 && claim.status === 'READY';
  const pending = all
    .filter((c) => PENDING_STATUSES.includes(c.payment_status) || (isDirectV2Ready(c) && c.payment_status !== 'PAID' && c.payment_status !== 'RECONCILED'))
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
  const awaitingReceipt = (batches.data || []).filter((b) => b.route_code === 'B' && b.status === 'HANDED_OFF');
  const routeC = all.filter((c) => c.work_type === 'COMMUNITY' || c.route_code === 'C' || c.route_code === null);
  const inPayment = all.filter((c) => c.payment_status !== 'NOT_STARTED' || isDirectV2Ready(c));
  const directReady = pending.filter((c) => isDirectV2Ready(c) && c.payment_status === 'NOT_STARTED');
  const routeCCount = ROUTE_C_GROUPS.reduce((s, g) => s + routeC.filter((c) => c.status === g.status).length, 0);

  const acknowledge = async (b: Batch) => {
    if (!window.confirm(`Acknowledge that your CSO has received batch ${b.reference}? Payments can be recorded only after receipt. This cannot be undone.`)) {
      return;
    }
    setNotice(null);
    const ok = await receive.run(() => api.post(`/batches/${b.id}/receive`));
    if (ok !== undefined) {
      setNotice(`Receipt of ${b.reference} acknowledged. Its claims are now pending payment.`);
      refreshAll();
    }
  };

  const tabs: { key: SectionKey; label: string }[] = [
    { key: 'all', label: 'Overview' },
    { key: 'pending', label: `Pending payments${claims.data ? ` (${pending.length})` : ''}` },
    { key: 'receipt', label: `Awaiting receipt${batches.data ? ` (${awaitingReceipt.length})` : ''}` },
    { key: 'routec', label: `Community claims${claims.data ? ` (${routeCCount})` : ''}` },
    { key: 'recon', label: 'Reconciliation' },
    { key: 'budget', label: 'Budget' },
    { key: 'export', label: 'Payroll export' },
  ];
  const show = (k: SectionKey) => section === 'all' || section === k;

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>CSO payments{names.length ? ` — ${names.join(', ')}` : ''}</h1>
          <p className="muted">Claims your CSO pays: record payments, upload proof, and keep community claims moving.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={refreshAll} disabled={claims.loading || batches.loading || budgets.loading || payPeriods.loading || organizations.loading}>
          {claims.loading || batches.loading || budgets.loading || payPeriods.loading || organizations.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <nav className="subnav" aria-label="CSO portal sections">
        {tabs.map((t) => (
          <button key={t.key} type="button" aria-current={section === t.key ? 'page' : undefined} onClick={() => setSection(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <Alert kind="success">{notice}</Alert>

      {show('pending') && (
        <Section title="Pending payments">
          <p className="muted small">Oldest first. Open a claim to record a payment, upload proof or confirm it as paid.</p>
          <p className="notice notice-info small">Version 2 payroll claims are available as soon as they are routed to your CSO; they do not require the legacy FHI360 batch handoff.</p>
          <AsyncState data={claims.data} error={claims.error} loading={claims.loading}>
            {() => (
              <>
                <div className="stats">
                  {PENDING_STATUSES.map((s) => {
                    const rows = pending.filter((c) => c.payment_status === s);
                    return (
                      <StatTile
                        key={s}
                        label={label(PAYMENT_STATUS_LABELS, s)}
                        value={num(rows.length)}
                        hint={`Outstanding ${money(sum(rows, outstanding))}`}
                        tone={s === 'FAILED' && rows.length ? 'danger' : rows.length ? 'warn' : undefined}
                      />
                    );
                  })}
                  {directReady.length > 0 && <StatTile label="Ready · v2 direct" value={num(directReady.length)} hint={`Outstanding ${money(sum(directReady, outstanding))}`} tone="warn" />}
                </div>
                {pending.length ? <PendingTable rows={pending} onOpen={setClaimId} /> : <Empty>No payments are waiting on your CSO.</Empty>}
              </>
            )}
          </AsyncState>
        </Section>
      )}

      {show('receipt') && (
        <Section title="Facility payroll batches awaiting receipt">
          <p className="muted small">
            FHI360 Finance hands facility payroll batches to your CSO. Acknowledge receipt first — payments for these claims can be recorded only after receipt.
          </p>
          <Alert>{receive.error}</Alert>
          <AsyncState data={batches.data} error={batches.error} loading={batches.loading}>
            {() =>
              awaitingReceipt.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Batch</th>
                        <th scope="col">Payor</th>
                        <th scope="col" className="num">
                          Lines
                        </th>
                        <th scope="col" className="num">
                          Total
                        </th>
                        <th scope="col">Handed off</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {awaitingReceipt.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBatchId(b.id)}>
                              {b.reference}
                            </button>
                          </td>
                          <td>{b.payor_name || '—'}</td>
                          <td className="num">{num(b.line_count)}</td>
                          <td className="num nowrap">{money(b.total_amount, b.currency)}</td>
                          <td className="nowrap">
                            {dateTime(b.handed_off_at)}
                            {b.handed_off_at && <div className="muted small">{ageSince(b.handed_off_at)} ago</div>}
                          </td>
                          <td>
                            {b.can_receive ? (
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => acknowledge(b)} disabled={receive.busy}>
                                {receive.busy ? 'Working…' : 'Acknowledge receipt'}
                              </button>
                            ) : (
                              <span className="muted small">Not assigned to you</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No batches are waiting for your receipt.</Empty>
              )
            }
          </AsyncState>
        </Section>
      )}

      {show('routec') && (
        <Section title="Community claims needing attention">
          <p className="notice notice-info small">Direct Route C claims are approved by CSO Finance after community verification, then paid externally and recorded here with proof. They do not need a payroll export batch.</p>
          <AsyncState data={claims.data} error={claims.error} loading={claims.loading}>
            {() =>
              routeCCount ? (
                <div className="stack">
                  {ROUTE_C_GROUPS.map((g) => {
                    const rows = routeC.filter((c) => c.status === g.status);
                    if (!rows.length) return null;
                    return (
                      <div key={g.status} className="stack">
                        <h4>
                          {g.title} ({rows.length})
                        </h4>
                        <p className="muted small">{g.hint}</p>
                        <ClaimList rows={rows} onOpen={setClaimId} meId={me?.id} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty>No community claims need attention.</Empty>
              )
            }
          </AsyncState>
        </Section>
      )}

      {show('recon') && (
        <Section title="Reconciliation">
          <p className="muted small">Every claim of your CSO that has entered payment, grouped by payment status. Only Paid and Reconciled claims have been paid.</p>
          <AsyncState data={claims.data} error={claims.error} loading={claims.loading}>
            {() =>
              inPayment.length ? (
                <div className="stack">
                  {RECON_GROUPS.map((g) => {
                    const rows = inPayment.filter((c) => c.payment_status === g.status);
                    return (
                      <details key={g.status} className="card">
                        <summary>
                          <strong>{g.title}</strong> — {num(rows.length)} claims · amount {money(sum(rows, (c) => Number(c.amount)))} · recorded{' '}
                          {money(sum(rows, (c) => Number(c.amount_paid || 0)))}
                        </summary>
                        {rows.length ? <ClaimList rows={rows} onOpen={setClaimId} /> : <Empty>None.</Empty>}
                      </details>
                    );
                  })}
                </div>
              ) : (
                <Empty>None of your CSO's claims have entered payment yet.</Empty>
              )
            }
          </AsyncState>
        </Section>
      )}

      {show('budget') && (
        <Section title="Budget">
          <AsyncState data={budgets.data} error={budgets.error} loading={budgets.loading} empty="No budget lines for your CSO.">
            {() => <BudgetHierarchy lines={csoBudgetLines} emptyMessage="No budget allocations are currently assigned to your CSO." />}
          </AsyncState>
        </Section>
      )}

      {show('export') && (
        <Section title="CSO payroll export">
          <p className="muted">
            Download a CSV of validated, routed payroll claims that are still unpaid. This creates a file only: it does not transfer money or change claim status.
          </p>
          <p className="notice notice-info small">
            Payroll export includes bank payment details only. Claims without complete bank details block the export; they are never silently omitted. Mobile-money service claims are not included.
          </p>
          {(organizations.error || payPeriods.error) && (
            <div className="stack">
              <Alert>{organizations.error || payPeriods.error}</Alert>
              <div className="row">
                {organizations.error && <button type="button" className="btn btn-secondary btn-sm" onClick={organizations.reload} disabled={organizations.loading}>Retry CSO list</button>}
                {payPeriods.error && <button type="button" className="btn btn-secondary btn-sm" onClick={payPeriods.reload} disabled={payPeriods.loading}>Retry pay periods</button>}
              </div>
            </div>
          )}
          {!organizations.error && !payPeriods.error && (
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selectedCsoId || !selectedPeriodId) return;
                const file = await payrollExport.run(() =>
                  api.blob(`/cso-finance/export-payroll${qs({ cso_id: Number(selectedCsoId), period_id: Number(selectedPeriodId) })}`, 'GET', 'payroll-export.csv'),
                );
                if (file) saveBlob(file);
              }}
            >
              <div className="grid-2">
                {organizations.data && organizations.data.length > 1 && (
                  <Field label="Assigned CSO">
                    <select value={selectedCsoId} onChange={(event) => setSelectedCsoId(event.target.value)} required>
                      {organizations.data.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Pay period">
                  <select value={selectedPeriodId} onChange={(event) => setSelectedPeriodId(event.target.value)} required disabled={payPeriods.loading || !payPeriods.data?.length}>
                    {(payPeriods.data || []).map((period) => (
                      <option key={period.id} value={period.id}>
                        {period.period_label || `${period.start_date} – ${period.end_date}`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {payPeriods.data?.length === 0 && <Empty>No pay periods are available for payroll export.</Empty>}
              {organizations.data?.length === 0 && <Empty>No assigned CSOs are available for payroll export.</Empty>}
              <Alert>{payrollExport.error}</Alert>
              <div>
                <button type="submit" className="btn btn-primary" disabled={payrollExport.busy || !selectedCsoId || !selectedPeriodId || !payPeriods.data?.length || !organizations.data?.length}>
                  {payrollExport.busy ? 'Preparing CSV…' : 'Download payroll CSV'}
                </button>
              </div>
            </form>
          )}
        </Section>
      )}

      {claimId !== null && <ClaimDrawer claimId={claimId} onClose={() => setClaimId(null)} onChanged={refreshAll} />}
      {batchId !== null && <BatchDrawer batchId={batchId} onClose={() => setBatchId(null)} onChanged={refreshAll} />}
    </div>
  );
}
