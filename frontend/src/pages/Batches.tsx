import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { dateTime, humanize, money, num, routeLabel } from '../format';
import { useAction, useApi } from '../hooks';
import { Batch } from '../types';
import { BatchDrawer, PaymentProgress } from '../components/batches/BatchDrawer';
import { Alert, AsyncState, KpiStrip, RouteBadge, StatusBadge } from '../components/ui';
import './polish-finance.css';

const BATCH_STATUS_SW: Record<string, string> = {
  DRAFT: 'Rasimu', EXPORTED: 'Imepakuliwa', HANDED_OFF: 'Imekabidhiwa CSO', RECEIVED: 'Imepokelewa', REVERSED: 'Imebatilishwa',
};
const fullyPaid = (b: Batch) => {
  const keys = Object.keys(b.payment_progress || {});
  return keys.length > 0 && keys.every((k) => k === 'PAID' || k === 'RECONCILED');
};

export function Batches() {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const list = useApi<Batch[]>('/batches');
  const create = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const routes = [...(hasRole('FHI360_FINANCE') ? ['A', 'B'] : []), ...(hasRole('CSO_FINANCE') ? ['C'] : [])];

  const createBatches = async (route: string) => {
    const name = routeLabel(route, lang);
    if (!window.confirm(sw
      ? `Unda makundi ya ${name} kutoka kila dai la ${name} lililo "Tayari kwa malipo"?`
      : `Create ${name} batches from every ${name} claim marked "Ready for payment"?`)) return;
    setNotice(null);
    const created = await create.run(() => api.post<Batch[]>('/batches', { route_code: route }));
    if (created) {
      const detail = created
        .map((b) => `${b.reference} (${sw ? `madai ${num(b.line_count)}` : `${num(b.line_count)} claims`}, ${money(b.total_amount, b.currency)})`)
        .join(', ');
      setNotice(sw
        ? `Makundi ${created.length} yameundwa: ${detail}.`
        : `Created ${created.length} batch${created.length === 1 ? '' : 'es'}: ${detail}.`);
      list.reload();
    }
  };

  const rows = list.data || [];
  const toHandOff = rows.filter((b) => b.can_hand_off).length;
  const toReceive = rows.filter((b) => b.can_receive).length;
  const paid = rows.filter(fullyPaid).length;
  const totals = new Map<string, number>();
  rows.forEach((b) => totals.set(b.currency, (totals.get(b.currency) || 0) + Number(b.total_amount)));

  return (
    <div className="stack-lg">
      <header className="page-header fin-title-only">
        <h1>{sw ? 'Makundi ya malipo' : 'Payment batches'}</h1>
      </header>

      {rows.length > 0 && (
        <KpiStrip
          label={sw ? 'Muhtasari wa makundi' : 'Batches at a glance'}
          items={[
            { label: sw ? 'Makundi' : 'Batches', value: num(rows.length), icon: 'layers', note: Array.from(totals, ([currency, total]) => money(total, currency)).join(' + ') },
            ...(hasRole('FHI360_FINANCE') ? [{ label: sw ? 'Tayari kukabidhiwa' : 'Ready to hand off', value: num(toHandOff), icon: 'route', tone: toHandOff ? 'warn' as const : 'neutral' as const }] : []),
            ...(hasRole('CSO_FINANCE') ? [{ label: sw ? 'Yanasubiri upokee' : 'Awaiting your receipt', value: num(toReceive), icon: 'clock', tone: toReceive ? 'warn' as const : 'neutral' as const }] : []),
            { label: sw ? 'Yamelipwa yote' : 'Fully paid', value: num(paid), icon: 'check', tone: 'success' },
          ]}
        />
      )}

      <div className="fin-toolbar">
        <p className="fin-footnote">
          {sw ? 'Makundi mapya yanajumuisha madai yaliyo ' : 'New batches include only claims marked '}<strong>{sw ? 'Tayari kwa malipo' : 'Ready for payment'}</strong>{sw ? ' tu.' : '.'}
          {hasRole('CSO_FINANCE') && (sw ? ' Makundi ya mishahara ya vituo yaliyokabidhiwa yanaonekana hapa.' : ' Handed-off facility payroll batches appear here.')}
        </p>
        <div className="fin-actions">
          {routes.map((r) => (
            <button key={r} type="button" className="btn btn-primary" onClick={() => createBatches(r)} disabled={create.busy}>
              {create.busy ? (sw ? 'Inafanya kazi…' : 'Working…') : (sw ? `Unda makundi ya ${routeLabel(r, lang)}` : `Create ${routeLabel(r, lang)} batches`)}
            </button>
          ))}
          <button type="button" className="btn btn-ghost" onClick={list.reload} disabled={list.loading}>
            {sw ? 'Pakia upya' : 'Refresh'}
          </button>
        </div>
      </div>

      <Alert kind="success">{notice}</Alert>
      <Alert>{create.error}</Alert>

      <AsyncState data={list.data} error={list.error} loading={list.loading} empty={sw ? 'Bado hakuna makundi.' : 'No batches yet.'}>
        {(items) => (
          <div className="table-wrap">
            <table className="table clickable">
              <thead>
                <tr>
                  <th scope="col">{sw ? 'Kumbukumbu' : 'Reference'}</th>
                  <th scope="col">{sw ? 'Mlipaji → mtekelezaji' : 'Payor → executor'}</th>
                  <th scope="col">{sw ? 'Hali ya kundi' : 'Batch status'}</th>
                  <th scope="col" className="num">{sw ? 'Jumla' : 'Total'}</th>
                  <th scope="col">{sw ? 'Maendeleo ya malipo' : 'Payment progress'}</th>
                  <th scope="col">{sw ? 'Imeandaliwa' : 'Created'}</th>
                  <th scope="col">{sw ? 'Imekabidhiwa / imepokelewa' : 'Handed off / received'}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => (
                  <tr
                    key={b.id}
                    tabIndex={0}
                    onClick={() => setOpenId(b.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(b.id); } }}
                    aria-label={sw ? `Fungua kundi ${b.reference}` : `Open batch ${b.reference}`}
                  >
                    <td>
                      <span className="fin-stack">
                        <span className="cell-main">{b.reference}</span>
                        <RouteBadge route={b.route_code} />
                        {(b.can_hand_off || b.can_receive) && (
                          <span className="badge badge-warn">{b.can_hand_off ? (sw ? 'Tayari kukabidhiwa' : 'Ready to hand off') : (sw ? 'Inasubiri upokee' : 'Awaiting your receipt')}</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <span className="cell-main">{b.payor_name || '—'}</span>
                      <span className="cell-sub">→ {b.executor_name || '—'}</span>
                    </td>
                    <td>
                      <StatusBadge status={b.status} label={sw ? BATCH_STATUS_SW[b.status] || humanize(b.status) : undefined} />
                    </td>
                    <td className="num">
                      <span className="cell-main">{money(b.total_amount, b.currency)}</span>
                      <span className="cell-sub">{sw ? `Mistari ${num(b.line_count)}` : `${num(b.line_count)} lines`}</span>
                    </td>
                    <td>
                      <PaymentProgress progress={b.payment_progress} />
                    </td>
                    <td>
                      <span className="cell-main">{dateTime(b.created_at)}</span>
                      <span className="cell-sub">{b.created_by_name || '—'}</span>
                    </td>
                    <td className="small">
                      {b.route_code === 'B' ? (
                        <>
                          <div className="nowrap">{sw ? 'Imekabidhiwa' : 'Handed off'}: {dateTime(b.handed_off_at)}</div>
                          <div className="nowrap">{sw ? 'Imepokelewa' : 'Received'}: {dateTime(b.received_at)}</div>
                        </>
                      ) : (
                        <span className="muted">{sw ? 'Haihusiki' : 'Not applicable'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncState>

      {openId !== null && <BatchDrawer batchId={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </div>
  );
}
