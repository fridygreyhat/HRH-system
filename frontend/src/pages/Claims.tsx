import React, { useEffect, useState } from 'react';
import { ApprovalFinanceGuide } from '../components/worklogs/ApprovalFinanceGuide';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { ClaimDrawer } from '../components/claims/ClaimDrawer';
import { CreateClaim } from '../components/claims/CreateClaim';
import { ServicesProofPaymentDialog } from '../components/claims/ServicesProofPaymentDialog';
import { RegionalFinanceNextSteps } from '../components/claims/RegionalFinanceNextSteps';
import { Alert, AsyncState, Field, RouteBadge, StatusBadge } from '../components/ui';
import { CLAIM_STATUS_LABELS, CLAIM_STATUSES, dateTime, money, PAYMENT_STATUS_LABELS, PAYMENT_STATUSES, payMonth, payMonthDates, routeLabel, todayLocal } from '../format';
import { useApi } from '../hooks';
import { ClaimSummary, PayPeriod } from '../types';

export function Claims() {
  const { hasRole } = useAuth();
  // Prefer the Regional Finance workflow even when the account also holds
  // Central Finance access. Its manual form is invalid for new work logs.
  const regionalFinance = hasRole('REGIONAL_FINANCE') && !hasRole('SUPER_ADMIN');
  const canCreate = hasRole('FHI360_FINANCE', 'CSO_FINANCE') && !regionalFinance;
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [route, setRoute] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [status, paymentStatus, route, periodId]);
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const claims = useApi<ClaimSummary[]>(`/claims${qs({ status, payment_status: paymentStatus, route, period_id: periodId, offset: page * 100, limit: 100 })}`);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [servicesProofPayment, setServicesProofPayment] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportMonth, setExportMonth] = useState(payMonth(todayLocal()));
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const downloadServices = async (format: 'csv' | 'pdf') => {
    setExportBusy(true);
    setExportError('');
    try {
      saveBlob(await api.blob(`/finance/services-payment-report/export${qs({ month: exportMonth, format })}`,
        'GET', `services-payment-${exportMonth}.${format}`));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not download the Services report.');
    } finally { setExportBusy(false); }
  };

  const onlyProvider = hasRole('PROVIDER') && !hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT', 'COMMUNITY_VERIFIER');

  return (
    <div className="stack-lg">
      <ApprovalFinanceGuide />
      <header className="page-header">
        <div>
          <h1>{onlyProvider ? 'My payment claims' : 'Payment claims'}</h1>
          <p className="muted small">
            Claim status and payment status are separate. A work-log claim awaiting finance review is an operational record, not routed or payable yet.
          </p>
        </div>
        <div className="row">
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Prepare a claim
            </button>
          )}
          {hasRole('FHI360_FINANCE') && (
            <button className="btn btn-secondary" onClick={() => setServicesProofPayment(true)}>
              Services proof + payment
            </button>
          )}
          <button className="btn btn-secondary" onClick={claims.reload} disabled={claims.loading}>
            Refresh
          </button>
        </div>
      </header>

      {regionalFinance && <RegionalFinanceNextSteps />}

      {hasRole('FHI360_FINANCE') && <section className="card stack" aria-label="Services payment documentation">
        <h2>Services payment report</h2>
        <p className="muted small">Routed Services across your assigned regions and cadres, including facilities, providers, service days, amounts and mobile numbers. Only the highest fixed service amount per day is payable. Payment status remains separate.</p>
        <div className="row">
          <Field label="Services report month" hint={payMonthDates(exportMonth)}><input type="month" required value={exportMonth} onChange={e => setExportMonth(e.target.value)} /></Field>
          <button className="btn btn-secondary" disabled={exportBusy || !exportMonth} onClick={() => downloadServices('csv')}>Download Services CSV</button>
          <button className="btn btn-secondary" disabled={exportBusy || !exportMonth} onClick={() => downloadServices('pdf')}>Download Services PDF</button>
        </div>
        <Alert>{exportError}</Alert>
      </section>}

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
                  <th>Services / category</th>
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
                    <td>{c.staff_name}{c.central_reviewer_name && <div className="muted small">Central reviewer: {c.central_reviewer_name}</div>}</td>
                    <td>
                      {c.service_names && c.service_names.length > 0 && (
                        <div><strong>{c.service_names.join(', ')}</strong></div>
                      )}
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

      <nav className="row" aria-label="Claims pages">
        <button className="btn btn-secondary" disabled={claims.loading || page === 0} onClick={() => setPage(page - 1)}>Previous claims</button>
        <span>Page {page + 1}</span>
        <button className="btn btn-secondary" disabled={claims.loading || (claims.data?.length || 0) < 100} onClick={() => setPage(page + 1)}>Next claims</button>
      </nav>

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
      {servicesProofPayment && (
        <ServicesProofPaymentDialog
          onClose={() => setServicesProofPayment(false)}
          onDone={(result) => {
            setServicesProofPayment(false);
            setNotice(`${result.paid_count} Services ${result.paid_count === 1 ? 'claim' : 'claims'} saved with proof.`);
            claims.reload();
          }}
        />
      )}
      {openId !== null && <ClaimDrawer claimId={openId} onClose={() => setOpenId(null)} onChanged={claims.reload} />}
    </div>
  );
}
