import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { dateTime, money, num, routeLabel } from '../format';
import { useAction, useApi } from '../hooks';
import { Batch } from '../types';
import { BatchDrawer, PaymentProgress } from '../components/batches/BatchDrawer';
import { Alert, AsyncState, RouteBadge, StatusBadge } from '../components/ui';

export function Batches() {
  const { hasRole } = useAuth();
  const list = useApi<Batch[]>('/batches');
  const create = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const routes = [...(hasRole('FHI360_FINANCE') ? ['A', 'B'] : []), ...(hasRole('CSO_FINANCE') ? ['C'] : [])];

  const createBatches = async (route: string) => {
    if (!window.confirm(`Create ${routeLabel(route)} batches from every ${routeLabel(route)} claim marked "Ready for payment"?`)) return;
    setNotice(null);
    const created = await create.run(() => api.post<Batch[]>('/batches', { route_code: route }));
    if (created) {
      setNotice(
        `Created ${created.length} batch${created.length === 1 ? '' : 'es'}: ${created
          .map((b) => `${b.reference} (${num(b.line_count)} claims, ${money(b.total_amount, b.currency)})`)
          .join(', ')}.`,
      );
      list.reload();
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Payroll batches</h1>
          <p className="muted">Exports of approved claims grouped by route, payor and executor.</p>
        </div>
        <div className="row">
          {routes.map((r) => (
            <button key={r} type="button" className="btn btn-primary" onClick={() => createBatches(r)} disabled={create.busy}>
              {create.busy ? 'Working…' : `Create ${routeLabel(r)} batches`}
            </button>
          ))}
          <button type="button" className="btn btn-secondary" onClick={list.reload} disabled={list.loading}>
            Refresh
          </button>
        </div>
      </div>

      <div className="notice notice-info">
        Only claims marked <strong>Ready for payment</strong> are included in a new batch. Exporting a batch does <strong>not</strong> mean staff have
        been paid: payment status is tracked separately on each claim until payment is recorded, proven and reconciled.
        {hasRole('CSO_FINANCE') && ' Facility payroll batches appear here once FHI360 Finance hands them off to your CSO.'}
      </div>
      <Alert kind="success">{notice}</Alert>
      <Alert>{create.error}</Alert>

      <AsyncState data={list.data} error={list.error} loading={list.loading} empty="No batches yet.">
        {(rows) => (
          <div className="table-wrap">
            <table className="table clickable">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Payor → executor</th>
                  <th scope="col">Batch status</th>
                  <th scope="col" className="num">
                    Lines
                  </th>
                  <th scope="col" className="num">
                    Total
                  </th>
                  <th scope="col">Payment progress</th>
                  <th scope="col">Created</th>
                  <th scope="col">Handed off / received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr
                    key={b.id}
                    tabIndex={0}
                    onClick={() => setOpenId(b.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpenId(b.id)}
                    aria-label={`Open batch ${b.reference}`}
                  >
                    <td className="nowrap">
                      <strong>{b.reference}</strong>
                      {(b.can_hand_off || b.can_receive) && (
                        <div>
                          <span className="badge badge-warn">{b.can_hand_off ? 'Ready to hand off' : 'Awaiting your receipt'}</span>
                        </div>
                      )}
                    </td>
                    <td>
                      <RouteBadge route={b.route_code} />
                    </td>
                    <td>
                      {b.payor_name || '—'} → {b.executor_name || '—'}
                    </td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="num">{num(b.line_count)}</td>
                    <td className="num nowrap">{money(b.total_amount, b.currency)}</td>
                    <td>
                      <PaymentProgress progress={b.payment_progress} />
                    </td>
                    <td>
                      <div className="nowrap">{dateTime(b.created_at)}</div>
                      <div className="muted small">{b.created_by_name || '—'}</div>
                    </td>
                    <td className="small">
                      {b.route_code === 'B' ? (
                        <>
                          <div className="nowrap">Handed off: {dateTime(b.handed_off_at)}</div>
                          <div className="nowrap">Received: {dateTime(b.received_at)}</div>
                        </>
                      ) : (
                        <span className="muted">Not applicable</span>
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
