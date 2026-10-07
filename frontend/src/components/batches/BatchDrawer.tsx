import React, { useState } from 'react';
import { api, saveBlob } from '../../api';
import { useAuth } from '../../AuthContext';
import { PAYMENT_STATUSES, dateTime, money, num } from '../../format';
import { useAction, useApi } from '../../hooks';
import { BatchDetail } from '../../types';
import { ClaimDrawer } from '../claims/ClaimDrawer';
import { Alert, AsyncState, Drawer, Facts, RouteBadge, Section, StatusBadge } from '../ui';

/** Payment-status counts for the claims in a batch, as small payment badges. */
export function PaymentProgress({ progress }: { progress: Record<string, number> }) {
  const keys = Object.keys(progress).sort((a, b) => PAYMENT_STATUSES.indexOf(a) - PAYMENT_STATUSES.indexOf(b));
  if (!keys.length) return <span className="muted">—</span>;
  return (
    <span className="badges">
      {keys.map((k) => (
        <span key={k} className="nowrap">
          <StatusBadge status={k} kind="payment" bare /> <span className="small">× {num(progress[k])}</span>
        </span>
      ))}
    </span>
  );
}

const RECEIVE_CONFIRM =
  'Acknowledge that your CSO has received this batch? Payments for its claims can be recorded only after receipt. This cannot be undone.';
const HAND_OFF_CONFIRM = 'Hand this Route B batch off to the CSO? The CSO will then acknowledge receipt and record payments. This cannot be undone.';

/** Batch detail: facts, payment progress, export lines, claims and the batch actions the server allows. */
export function BatchDrawer({ batchId, onClose, onChanged }: { batchId: number; onClose: () => void; onChanged?: () => void }) {
  const { hasRole } = useAuth();
  const { data, error, loading, reload, setData } = useApi<BatchDetail>(`/batches/${batchId}`);
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<number | null>(null);
  const canDownload = hasRole('FHI360_FINANCE', 'CSO_FINANCE');

  const download = async (b: BatchDetail, fmt: 'csv' | 'xlsx') => {
    setNotice(null);
    const res = await action.run(() => api.blob(`/batches/${b.id}/export.${fmt}`, 'GET', `${b.reference}.${fmt}`));
    if (res) saveBlob(res);
  };

  const transition = async (b: BatchDetail, kind: 'hand-off' | 'receive') => {
    if (!window.confirm(kind === 'hand-off' ? HAND_OFF_CONFIRM : RECEIVE_CONFIRM)) return;
    setNotice(null);
    const updated = await action.run(() => api.post<BatchDetail>(`/batches/${b.id}/${kind}`));
    if (updated) {
      setData(updated);
      setNotice(kind === 'hand-off' ? 'Batch handed off to the CSO.' : 'Receipt acknowledged. Payments can now be recorded for these claims.');
      onChanged?.();
    }
  };

  // One dialog at a time: while a claim is open the batch drawer steps aside and returns when the claim closes.
  if (claimId !== null) {
    return (
      <ClaimDrawer
        claimId={claimId}
        onClose={() => setClaimId(null)}
        onChanged={() => {
          reload();
          onChanged?.();
        }}
      />
    );
  }

  return (
    <Drawer title={data ? `Batch ${data.reference}` : `Batch #${batchId}`} onClose={onClose} wide>
      <AsyncState data={data} error={error} loading={loading}>
        {(b) => (
          <div className="stack-lg">
            <Alert kind="success">{notice}</Alert>
            <Alert>{action.error}</Alert>
            <div className="notice notice-info">
              A batch is an export of claims that were marked ready for payment. Exporting or handing off a batch does not mean staff have been paid —
              check each claim's payment status.
            </div>
            <div className="row">
              {canDownload && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => download(b, 'csv')} disabled={action.busy}>
                    Download CSV
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => download(b, 'xlsx')} disabled={action.busy}>
                    Download XLSX
                  </button>
                </>
              )}
              {b.can_hand_off && (
                <button type="button" className="btn btn-primary" onClick={() => transition(b, 'hand-off')} disabled={action.busy}>
                  Hand off to CSO
                </button>
              )}
              {b.can_receive && (
                <button type="button" className="btn btn-primary" onClick={() => transition(b, 'receive')} disabled={action.busy}>
                  Acknowledge receipt
                </button>
              )}
            </div>

            <Facts
              items={[
                ['Reference', b.reference],
                ['Route', <RouteBadge route={b.route_code} />],
                ['Batch status', <StatusBadge status={b.status} />],
                ['Payor', b.payor_name],
                ['Executor (pays staff)', b.executor_name],
                ['Lines', num(b.line_count)],
                ['Total', money(b.total_amount, b.currency)],
                ['Created by', b.created_by_name],
                ['Created', dateTime(b.created_at)],
                ['Handed off', b.route_code === 'B' ? dateTime(b.handed_off_at) : 'Not applicable'],
                ['Received by CSO', b.route_code === 'B' ? dateTime(b.received_at) : 'Not applicable'],
                ['Payment progress', <PaymentProgress progress={b.payment_progress} />],
              ]}
            />

            <Section title={`Claims (${b.claims.length})`}>
              <p className="muted small">Open a claim to record payments, upload proof or see its history.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Claim</th>
                      <th scope="col">Claim status</th>
                      <th scope="col">Payment status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.claims.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClaimId(c.id)}>
                            Claim #{c.id}
                          </button>
                        </td>
                        <td>
                          <StatusBadge status={c.status} kind="claim" />
                        </td>
                        <td>
                          <StatusBadge status={c.payment_status} kind="payment" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={`Export lines (${b.lines.length})`}>
              <p className="muted small">The lines exactly as exported when the batch was created.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Claim</th>
                      <th scope="col">Staff</th>
                      <th scope="col">Cadre</th>
                      <th scope="col">Facility</th>
                      <th scope="col">Region</th>
                      <th scope="col">Period</th>
                      <th scope="col">Category</th>
                      <th scope="col">Budget line</th>
                      <th scope="col">Payment method</th>
                      <th scope="col">Components</th>
                      <th scope="col" className="num">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.lines.map((l) => (
                      <tr key={l.claim_id}>
                        <td>#{l.claim_id}</td>
                        <td>
                          {l.staff_name}
                          {l.phone && <div className="muted small">{l.phone}</div>}
                        </td>
                        <td>{l.cadre}</td>
                        <td>{l.facility || '—'}</td>
                        <td>{l.region || '—'}</td>
                        <td className="nowrap">{l.period}</td>
                        <td>{l.category}</td>
                        <td>{l.budget_line || '—'}</td>
                        <td>
                          {[l.payment_method, l.payment_provider].filter(Boolean).join(' · ') || <span className="muted">Not set</span>}
                          {l.payment_account ? <div className="muted small">Account {l.payment_account}</div> : null}
                        </td>
                        <td className="small">{l.components || '—'}</td>
                        <td className="num nowrap">{money(l.amount, l.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}
      </AsyncState>
    </Drawer>
  );
}
