import React, { useState } from 'react';
import { ApprovalFinanceGuide } from '../components/worklogs/ApprovalFinanceGuide';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { ClaimDrawer } from '../components/claims/ClaimDrawer';
import { CreateClaim } from '../components/claims/CreateClaim';
import { Alert, AsyncState, Field, RouteBadge, StatusBadge } from '../components/ui';
import { CLAIM_STATUS_LABELS, CLAIM_STATUSES, dateTime, money, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, routeLabel } from '../format';
import { useApi } from '../hooks';
import { ClaimSummary, PayPeriod } from '../types';

export function Claims() {
  const { hasRole } = useAuth();
  const canCreate = hasRole('FHI360_FINANCE', 'CSO_FINANCE');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [route, setRoute] = useState('');
  const [periodId, setPeriodId] = useState('');
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const claims = useApi<ClaimSummary[]>(`/claims${qs({ status, payment_status: paymentStatus, route, period_id: periodId })}`);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onlyProvider = hasRole('PROVIDER') && !hasRole('FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT', 'COMMUNITY_VERIFIER');

  return (
    <div className="stack-lg">
      <ApprovalFinanceGuide />
      <header className="page-header">
        <div>
          <h1>{onlyProvider ? 'My payment claims' : 'Payment claims'}</h1>
          <p className="muted small">
            Claim status and payment status are separate. A work-log claim awaiting finance review is an operational record, not a routed, budget-committed or payable claim.
          </p>
        </div>
        <div className="row">
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Prepare a claim
            </button>
          )}
          <button className="btn btn-secondary" onClick={claims.reload} disabled={claims.loading}>
            Refresh
          </button>
        </div>
      </header>

      <div className="filters" role="search">
        <Field label="Claim status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {CLAIM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CLAIM_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment status">
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
            <option value="">All</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment">
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="">All</option>
            {['A', 'B', 'C'].map((r) => (
              <option key={r} value={r}>
                {routeLabel(r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Period">
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">All</option>
            {(periods.data || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_label || p.start_date}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Alert kind="success">{notice}</Alert>

      <AsyncState data={claims.data} error={claims.error} loading={claims.loading} empty="No claims match these filters.">
        {(rows) => (
          <div className="table-wrap">
            <table className="clickable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Staff</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Period</th>
                  <th>Payment</th>
                  <th>Claim status</th>
                  <th>Payment status</th>
                  <th className="num">Amount</th>
                  <th className="num">Recorded paid</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    onClick={() => setOpenId(c.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpenId(c.id)}
                    aria-label={`Open claim ${c.id}`}
                  >
                    <td>{c.id}</td>
                    <td>{c.staff_name}</td>
                    <td>
                      {c.category_name || (c.category_id == null ? 'Category not selected' : `Category #${c.category_id}`)}
                      {c.exception_reason && (
                        <div className="small" style={{ color: 'var(--warn-fg)' }} title={c.exception_reason}>
                          Exception
                        </div>
                      )}
                    </td>
                    <td>{c.work_type && c.work_type !== 'LEGACY' ? <span className="badge badge-neutral">{c.work_type}</span> : '—'}</td>
                    <td>{c.period_label}</td>
                    <td>
                      <RouteBadge route={c.route_code} />
                    </td>
                    <td>
                      <StatusBadge kind="claim" status={c.status} bare />
                    </td>
                    <td>
                      <StatusBadge kind="payment" status={c.payment_status} bare />
                    </td>
                    <td className="num">{money(c.amount, c.currency)}</td>
                    <td className="num">{money(c.amount_paid, c.currency)}</td>
                    <td className="nowrap small">{dateTime(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncState>

      {creating && (
        <CreateClaim
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setNotice(`Claim #${c.id} created (${CLAIM_STATUS_LABELS[c.status] || c.status}).`);
            claims.reload();
            setOpenId(c.id);
          }}
        />
      )}
      {openId !== null && <ClaimDrawer claimId={openId} onClose={() => setOpenId(null)} onChanged={claims.reload} />}
    </div>
  );
}
