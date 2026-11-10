import React, { useState } from 'react';
import { api, saveBlob } from '../../api';
import { useAuth } from '../../AuthContext';
import { PAYMENT_STATUSES, cadreName, dateTime, money, num } from '../../format';
import { useAction, useApi } from '../../hooks';
import { BatchDetail } from '../../types';
import { ClaimDrawer } from '../claims/ClaimDrawer';
import { Alert, AsyncState, Drawer, Facts, PersonCell, ReasonDialog, RouteBadge, Section, StatusBadge } from '../ui';

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
const RECEIVE_CONFIRM_SW =
  'Thibitisha kwamba CSO yako imepokea kundi hili la malipo? Malipo ya madai yake yanaweza kurekodiwa tu baada ya kupokelewa. Hili haliwezi kutenduliwa.';
const HAND_OFF_CONFIRM = 'Hand this facility payroll batch off to the CSO? The CSO will then acknowledge receipt and record payments. This cannot be undone.';
const HAND_OFF_CONFIRM_SW = 'Kabidhi kundi hili la malipo ya Payroll ya kituo kwa CSO? CSO itathibitisha kupokea kisha kurekodi malipo. Hili haliwezi kutenduliwa.';

/** Batch detail: facts, payment progress, export lines, claims and the batch actions the server allows. */
export function BatchDrawer({ batchId, onClose, onChanged }: { batchId: number; onClose: () => void; onChanged?: () => void }) {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const na = sw ? 'Haihusiki' : 'Not applicable';
  const { data, error, loading, reload, setData } = useApi<BatchDetail>(`/batches/${batchId}`);
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const [claimId, setClaimId] = useState<number | null>(null);
  const [reversing, setReversing] = useState(false);
  const canDownload = hasRole('FHI360_FINANCE', 'CSO_FINANCE') && data?.status !== 'REVERSED';

  const download = async (b: BatchDetail, fmt: 'csv' | 'xlsx') => {
    setNotice(null);
    const res = await action.run(() => api.blob(`/batches/${b.id}/export.${fmt}`, 'GET', `${b.reference}.${fmt}`));
    if (res) saveBlob(res);
  };

  const transition = async (b: BatchDetail, kind: 'hand-off' | 'receive') => {
    if (!window.confirm(kind === 'hand-off' ? (sw ? HAND_OFF_CONFIRM_SW : HAND_OFF_CONFIRM) : (sw ? RECEIVE_CONFIRM_SW : RECEIVE_CONFIRM))) return;
    setNotice(null);
    const updated = await action.run(() => api.post<BatchDetail>(`/batches/${b.id}/${kind}`));
    if (updated) {
      setData(updated);
      setNotice(kind === 'hand-off'
        ? (sw ? 'Kundi la malipo limekabidhiwa kwa CSO.' : 'Batch handed off to the CSO.')
        : (sw ? 'Upokeaji umethibitishwa. Malipo ya madai haya sasa yanaweza kurekodiwa.' : 'Receipt acknowledged. Payments can now be recorded for these claims.'));
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

  if (reversing && data) {
    return (
      <ReasonDialog
        title={sw ? `Batilisha kundi la malipo ${data.reference}` : `Reverse batch ${data.reference}`}
        description={sw
          ? 'Batilisha tu kama hakuna aliyelipwa kutoka faili hili. Madai yake yanarudi kwenye Tayari kwa malipo. Hili haliwezi kutenduliwa.'
          : 'Reverse only if nobody has paid from this file. Its claims return to Ready for payment. This cannot be undone.'}
        required
        danger
        confirmLabel={sw ? 'Batilisha kundi' : 'Reverse batch'}
        onClose={() => setReversing(false)}
        onConfirm={async (reason) => {
          const updated = await api.post<BatchDetail>(`/batches/${data.id}/reverse`, { reason });
          setData(updated);
          setReversing(false);
          setNotice(sw ? 'Kundi limebatilishwa. Madai yake yamerudi kwenye Tayari kwa malipo.' : 'Batch reversed. Its claims are back in Ready for payment.');
          onChanged?.();
        }}
      />
    );
  }

  return (
    <Drawer title={data ? `${sw ? 'Kundi la malipo' : 'Batch'} ${data.reference}` : `${sw ? 'Kundi la malipo' : 'Batch'} #${batchId}`} onClose={onClose} wide>
      <AsyncState data={data} error={error} loading={loading}>
        {(b) => (
          <div className="stack-lg">
            <Alert kind="success">{notice}</Alert>
            <Alert>{action.error}</Alert>
            {b.status === 'REVERSED' && (
              <Alert kind="warn">
                {sw
                  ? `Limebatilishwa na ${b.reversed_by_name} tarehe ${dateTime(b.reversed_at)}: ${b.reversal_reason}. Usilipe kutoka nakala yoyote ya faili hili.`
                  : `Reversed by ${b.reversed_by_name} on ${dateTime(b.reversed_at)}: ${b.reversal_reason}. Do not pay from any copy of this file.`}
              </Alert>
            )}
            <Alert kind="info">
              {sw ? 'Kupakua au kukabidhi kundi la malipo haimaanishi watumishi wamelipwa.' : 'Exporting or handing off a batch does not mean staff are paid.'}
            </Alert>
            <div className="row">
              {canDownload && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => download(b, 'csv')} disabled={action.busy}>
                    {sw ? 'Pakua CSV' : 'Download CSV'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => download(b, 'xlsx')} disabled={action.busy}>
                    {sw ? 'Pakua XLSX' : 'Download XLSX'}
                  </button>
                </>
              )}
              {b.can_hand_off && (
                <button type="button" className="btn btn-primary" onClick={() => transition(b, 'hand-off')} disabled={action.busy}>
                  {sw ? 'Kabidhi kwa CSO' : 'Hand off to CSO'}
                </button>
              )}
              {b.can_reverse && (
                <button type="button" className="btn btn-danger" onClick={() => { setNotice(null); setReversing(true); }} disabled={action.busy}>
                  {sw ? 'Batilisha kundi' : 'Reverse batch'}
                </button>
              )}
              {b.can_receive && (
                <button type="button" className="btn btn-primary" onClick={() => transition(b, 'receive')} disabled={action.busy}>
                  {sw ? 'Thibitisha kupokea' : 'Acknowledge receipt'}
                </button>
              )}
            </div>

            <Facts
              items={[
                [sw ? 'Kumbukumbu' : 'Reference', b.reference],
                [sw ? 'Malipo' : 'Payment', <RouteBadge route={b.route_code} />],
                [sw ? 'Hali ya kundi' : 'Batch status', <StatusBadge status={b.status} />],
                [sw ? 'Mlipaji' : 'Payor', b.payor_name],
                [sw ? 'Mtekelezaji (analipa watumishi)' : 'Executor (pays staff)', b.executor_name],
                [sw ? 'Mistari' : 'Lines', num(b.line_count)],
                [sw ? 'Jumla' : 'Total', money(b.total_amount, b.currency)],
                [sw ? 'Imeandaliwa na' : 'Created by', b.created_by_name],
                [sw ? 'Imeandaliwa' : 'Created', dateTime(b.created_at)],
                [sw ? 'Imekabidhiwa' : 'Handed off', b.route_code === 'B' ? dateTime(b.handed_off_at) : na],
                [sw ? 'Imepokelewa na CSO' : 'Received by CSO', b.route_code === 'B' ? dateTime(b.received_at) : na],
                [sw ? 'Maendeleo ya malipo' : 'Payment progress', <PaymentProgress progress={b.payment_progress} />],
              ]}
            />

            <Section title={`${sw ? 'Madai' : 'Claims'} (${b.claims.length})`}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{sw ? 'Dai' : 'Claim'}</th>
                      <th scope="col">{sw ? 'Hali ya dai' : 'Claim status'}</th>
                      <th scope="col">{sw ? 'Hali ya malipo' : 'Payment status'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.claims.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setClaimId(c.id)}>
                            {sw ? 'Dai' : 'Claim'} #{c.id}
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

            <Section title={`${sw ? 'Mistari ya faili' : 'Export lines'} (${b.lines.length})`}>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{sw ? 'Dai' : 'Claim'}</th>
                      <th scope="col">{sw ? 'Mtumishi' : 'Staff'}</th>
                      <th scope="col">{sw ? 'Kituo / mkoa' : 'Facility / region'}</th>
                      <th scope="col">{sw ? 'Kipindi / kategoria' : 'Period / category'}</th>
                      <th scope="col">{sw ? 'Mstari wa bajeti' : 'Budget line'}</th>
                      <th scope="col">{sw ? 'Njia ya malipo' : 'Payment method'}</th>
                      <th scope="col">{sw ? 'Vipengele' : 'Components'}</th>
                      <th scope="col" className="num">
                        {sw ? 'Kiasi' : 'Amount'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.lines.map((l) => (
                      <tr key={l.claim_id}>
                        <td className="nowrap">#{l.claim_id}</td>
                        <td>
                          <PersonCell name={l.staff_name} sub={[cadreName(l.cadre, lang), l.phone].filter(Boolean).join(' · ')} />
                        </td>
                        <td>
                          <span className="cell-main">{l.facility || '—'}</span>
                          <span className="cell-sub">{l.region || '—'}</span>
                        </td>
                        <td>
                          <span className="cell-main">{l.period}</span>
                          <span className="cell-sub">{l.category}</span>
                        </td>
                        <td>{l.budget_line || '—'}</td>
                        <td>
                          {[l.payment_method, l.payment_provider].filter(Boolean).join(' · ') || <span className="muted">{sw ? 'Haijawekwa' : 'Not set'}</span>}
                          {l.payment_account ? <div className="muted small nowrap">{sw ? 'Akaunti' : 'Account'} {l.payment_account}</div> : null}
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
