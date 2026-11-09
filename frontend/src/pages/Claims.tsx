import React, { useEffect, useState } from 'react';
import { ApprovalFinanceGuide } from '../components/worklogs/ApprovalFinanceGuide';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { ClaimDrawer } from '../components/claims/ClaimDrawer';
import { CreateClaim } from '../components/claims/CreateClaim';
import { ServicesProofPaymentDialog } from '../components/claims/ServicesProofPaymentDialog';
import { RegionalFinanceNextSteps } from '../components/claims/RegionalFinanceNextSteps';
import { ServicesReportPanel } from '../components/claims/ServicesReportPanel';
import { Alert, AsyncState, Field, RouteBadge, StatusBadge } from '../components/ui';
import { CLAIM_STATUS_LABELS, CLAIM_STATUS_LABELS_SW, CLAIM_STATUSES, dateTime, money, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS_SW, PAYMENT_STATUSES, routeLabel } from '../format';
import { useApi } from '../hooks';
import { ClaimSummary, PayPeriod } from '../types';

const WORK_TYPE_LABELS_SW: Record<string, string> = { SERVICES: 'Huduma', PAYROLL: 'Payroll', COMMUNITY: 'Jamii' };

export function Claims() {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
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
  const providerOnly = hasRole('PROVIDER') && !hasRole('FHI360_FINANCE', 'CSO_FINANCE', 'REGIONAL_FINANCE', 'RPM', 'OVERSIGHT', 'COMMUNITY_VERIFIER');
  const claims = useApi<ClaimSummary[]>(`/claims${qs({ status, payment_status: paymentStatus, route, period_id: periodId, offset: page * 100, limit: 100 })}`);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [servicesProofPayment, setServicesProofPayment] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onlyProvider = hasRole('PROVIDER') && !hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT', 'COMMUNITY_VERIFIER');

  return (
    <div className="stack-lg">
      <ApprovalFinanceGuide />
      <header className="page-header">
        <div>
          <h1>{onlyProvider ? (sw ? 'Madai yangu ya malipo' : 'My payment claims') : (sw ? 'Madai ya malipo' : 'Payment claims')}</h1>
          <p className="muted small">
            {sw
              ? 'Hali ya dai na hali ya malipo ni vitu tofauti. Dai la kumbukumbu ya kazi linalosubiri mapitio ya Fedha ni rekodi ya kiutendaji; bado halijatumwa kwa mlipaji wala haliwezi kulipwa.'
              : 'Claim status and payment status are separate. A work-log claim awaiting finance review is an operational record, not routed or payable yet.'}
          </p>
        </div>
        <div className="row">
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              {sw ? 'Andaa dai' : 'Prepare a claim'}
            </button>
          )}
          {hasRole('FHI360_FINANCE') && (
            <button className="btn btn-secondary" onClick={() => setServicesProofPayment(true)}>
              {sw ? 'Uthibitisho + malipo ya Huduma' : 'Services proof + payment'}
            </button>
          )}
          <button className="btn btn-secondary" onClick={claims.reload} disabled={claims.loading}>
            {sw ? 'Pakia upya' : 'Refresh'}
          </button>
        </div>
      </header>

      {regionalFinance && <RegionalFinanceNextSteps />}

      {hasRole('FHI360_FINANCE') && <ServicesReportPanel onPaid={claims.reload} />}

      <div className="filters" role="search">
        <Field label={sw ? 'Hali ya dai' : 'Claim status'}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{sw ? 'Zote' : 'All'}</option>
            {CLAIM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {(sw && CLAIM_STATUS_LABELS_SW[s]) || CLAIM_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={sw ? 'Hali ya malipo' : 'Payment status'}>
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
            <option value="">{sw ? 'Zote' : 'All'}</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {(sw && PAYMENT_STATUS_LABELS_SW[s]) || PAYMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={sw ? 'Malipo' : 'Payment'}>
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="">{sw ? 'Yote' : 'All'}</option>
            {['A', 'B', 'C'].map((r) => (
              <option key={r} value={r}>
                {routeLabel(r, lang)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={sw ? 'Kipindi' : 'Period'}>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">{sw ? 'Vyote' : 'All'}</option>
            {(periods.data || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_label || p.start_date}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Alert kind="success">{notice}</Alert>

      <AsyncState data={claims.data} error={claims.error} loading={claims.loading} empty={sw ? 'Hakuna madai yanayolingana na vichujio hivi.' : 'No claims match these filters.'}>
        {(rows) => (providerOnly ? (
          <div className="stack">
            {rows.map((c) => (
              <button key={c.id} type="button" className="card log-card" onClick={() => setOpenId(c.id)}>
                <div className="row-between"><strong>{c.period_label}</strong><strong>{money(c.amount, c.currency)}</strong></div>
                <div className="row"><StatusBadge kind="claim" status={c.status} bare /><StatusBadge kind="payment" status={c.payment_status} bare /></div>
              </button>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="clickable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{sw ? 'Mtumishi' : 'Staff'}</th>
                  <th>{sw ? 'Huduma / kategoria' : 'Services / category'}</th>
                  <th>{sw ? 'Aina' : 'Type'}</th>
                  <th>{sw ? 'Kipindi' : 'Period'}</th>
                  <th>{sw ? 'Malipo' : 'Payment'}</th>
                  <th>{sw ? 'Hali ya dai' : 'Claim status'}</th>
                  <th>{sw ? 'Hali ya malipo' : 'Payment status'}</th>
                  <th className="num">{sw ? 'Kiasi' : 'Amount'}</th>
                  <th className="num">{sw ? 'Kilicholipwa' : 'Recorded paid'}</th>
                  <th>{sw ? 'Imesasishwa' : 'Updated'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    onClick={() => setOpenId(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(c.id); } }}
                    aria-label={sw ? `Fungua dai ${c.id}` : `Open claim ${c.id}`}
                  >
                    <td>{c.id}</td>
                    <td>{c.staff_name}{c.central_reviewer_name && <div className="muted small">{sw ? 'Mkaguzi wa Fedha Kuu' : 'Central reviewer'}: {c.central_reviewer_name}</div>}</td>
                    <td>
                      {c.service_names && c.service_names.length > 0 && (
                        <div><strong>{c.service_names.join(', ')}</strong></div>
                      )}
                      {c.category_name || (c.category_id == null ? (sw ? 'Kategoria haijachaguliwa' : 'Category not selected') : `${sw ? 'Kategoria' : 'Category'} #${c.category_id}`)}
                      {c.exception_reason && (
                        <div className="small" style={{ color: 'var(--warn-fg)' }} title={c.exception_reason}>
                          {sw ? 'Dosari' : 'Exception'}
                        </div>
                      )}
                    </td>
                    <td>{c.work_type && c.work_type !== 'LEGACY' ? <span className="badge badge-neutral">{(sw && WORK_TYPE_LABELS_SW[c.work_type]) || c.work_type}</span> : '—'}</td>
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
        ))}
      </AsyncState>

      <nav className="row" aria-label={sw ? 'Kurasa za madai' : 'Claims pages'}>
        <button className="btn btn-secondary" disabled={claims.loading || page === 0} onClick={() => setPage(page - 1)}>{sw ? 'Madai yaliyotangulia' : 'Previous claims'}</button>
        <span>{sw ? 'Ukurasa' : 'Page'} {page + 1}</span>
        <button className="btn btn-secondary" disabled={claims.loading || (claims.data?.length || 0) < 100} onClick={() => setPage(page + 1)}>{sw ? 'Madai yanayofuata' : 'Next claims'}</button>
      </nav>

      {creating && (
        <CreateClaim
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setNotice(sw
              ? `Dai #${c.id} limeundwa (${CLAIM_STATUS_LABELS_SW[c.status] || CLAIM_STATUS_LABELS[c.status] || c.status}).`
              : `Claim #${c.id} created (${CLAIM_STATUS_LABELS[c.status] || c.status}).`);
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
            setNotice(sw
              ? (result.paid_count === 1 ? 'Dai 1 la Huduma limehifadhiwa na uthibitisho.' : `Madai ${result.paid_count} ya Huduma yamehifadhiwa na uthibitisho.`)
              : `${result.paid_count} Services ${result.paid_count === 1 ? 'claim' : 'claims'} saved with proof.`);
            claims.reload();
          }}
        />
      )}
      {openId !== null && <ClaimDrawer claimId={openId} onClose={() => setOpenId(null)} onChanged={claims.reload} />}
    </div>
  );
}
