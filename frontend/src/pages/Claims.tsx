import React, { useEffect, useState } from 'react';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { ClaimDrawer } from '../components/claims/ClaimDrawer';
import { CreateClaim } from '../components/claims/CreateClaim';
import { ServicesProofPaymentDialog } from '../components/claims/ServicesProofPaymentDialog';
import { RegionalFinanceNextSteps } from '../components/claims/RegionalFinanceNextSteps';
import { ServicesReportPanel } from '../components/claims/ServicesReportPanel';
import { Alert, AsyncState, Field, Kpi, KpiStrip, PersonCell, RouteBadge, StatusBadge, WorkTypeChip } from '../components/ui';
import { CLAIM_STATUS_LABELS, CLAIM_STATUS_LABELS_SW, CLAIM_STATUSES, dateTime, money, num, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS_SW, PAYMENT_STATUSES, routeLabel } from '../format';
import { useApi } from '../hooks';
import { ClaimSummary, PayPeriod } from '../types';
import './polish-finance.css';

const COMMUNITY_SW = 'Jamii';
const REVIEW_STATUSES = ['PENDING_CENTRAL_REVIEW', 'PENDING_FINANCE_REVIEW', 'AWAITING_APPROVAL', 'PENDING_COMMUNITY_VERIFICATION'];
const PAYABLE_STATUSES = ['APPROVED', 'READY', 'EXPORTED', 'HANDED_OFF'];
const isPaid = (c: ClaimSummary) => c.payment_status === 'PAID' || c.payment_status === 'RECONCILED';

/** Totals per currency, e.g. "TZS 120,000 + USD 40". */
function totalText(rows: ClaimSummary[], pick: (c: ClaimSummary) => number): string {
  const totals = new Map<string, number>();
  rows.forEach((c) => totals.set(c.currency || 'TZS', (totals.get(c.currency || 'TZS') || 0) + pick(c)));
  return totals.size ? Array.from(totals, ([currency, total]) => money(total, currency)).join(' + ') : money(0);
}

/** Headline numbers from the claims already on screen. */
function claimKpis(rows: ClaimSummary[], sw: boolean, central: boolean, status: string, setStatus: (s: string) => void): Kpi[] {
  const review = central ? rows.filter((c) => c.status === 'PENDING_CENTRAL_REVIEW') : rows.filter((c) => REVIEW_STATUSES.includes(c.status));
  const payable = rows.filter((c) => PAYABLE_STATUSES.includes(c.status) && !isPaid(c));
  const paid = rows.filter(isPaid);
  const onPage = sw ? 'Kwenye ukurasa huu' : 'On this page';
  return [
    {
      label: central ? (sw ? 'Zinasubiri mapitio ya Fedha Kuu' : 'Awaiting Central Finance review') : (sw ? 'Zinasubiri mapitio' : 'Awaiting review'),
      value: num(review.length), tone: review.length ? 'warn' : 'neutral', icon: 'clock',
      note: review.length ? totalText(review, (c) => Number(c.amount)) : onPage,
      ...(central ? { onClick: () => setStatus(status === 'PENDING_CENTRAL_REVIEW' ? '' : 'PENDING_CENTRAL_REVIEW'), active: status === 'PENDING_CENTRAL_REVIEW' } : {}),
    },
    {
      label: sw ? 'Tayari kulipwa' : 'Ready to pay', value: num(payable.length), tone: payable.length ? 'info' : 'neutral', icon: 'wallet',
      note: payable.length ? `${totalText(payable, (c) => Math.max(0, Number(c.amount) - Number(c.amount_paid || 0)))} ${sw ? 'bado' : 'outstanding'}` : onPage,
    },
    { label: sw ? 'Zimelipwa' : 'Paid', value: num(paid.length), tone: 'success', icon: 'check', note: totalText(paid, (c) => Number(c.amount_paid || 0)) },
    { label: sw ? 'Jumla ya kiasi' : 'Total amount', value: totalText(rows, (c) => Number(c.amount)), icon: 'receipt', note: sw ? `Madai ${num(rows.length)} kwenye ukurasa huu` : `${num(rows.length)} claims on this page` },
  ];
}

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
      <header className="page-header fin-title-only">
        <h1>{onlyProvider ? (sw ? 'Madai yangu ya malipo' : 'My payment claims') : (sw ? 'Madai ya malipo' : 'Payment claims')}</h1>
      </header>

      {!providerOnly && claims.data && claims.data.length > 0 && (
        <KpiStrip label={sw ? 'Muhtasari wa madai' : 'Claims at a glance'} items={claimKpis(claims.data, sw, hasRole('FHI360_FINANCE'), status, setStatus)} />
      )}

      {regionalFinance && <RegionalFinanceNextSteps />}

      {hasRole('FHI360_FINANCE') && <ServicesReportPanel onPaid={claims.reload} />}

      <div className="fin-toolbar">
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
        <div className="fin-actions">
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
          <button className="btn btn-ghost" onClick={claims.reload} disabled={claims.loading}>
            {sw ? 'Pakia upya' : 'Refresh'}
          </button>
        </div>
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
            <table className="clickable fin-claims-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{sw ? 'Mtumishi' : 'Staff'}</th>
                  <th>{sw ? 'Huduma / kategoria' : 'Services / category'}</th>
                  <th>{sw ? 'Aina / malipo' : 'Type / payment'}</th>
                  <th>{sw ? 'Hali ya dai' : 'Claim status'}</th>
                  <th>{sw ? 'Hali ya malipo' : 'Payment status'}</th>
                  <th className="num">{sw ? 'Kiasi' : 'Amount'}</th>
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
                    <td className="muted nowrap">#{c.id}</td>
                    <td><PersonCell name={c.staff_name} sub={c.period_label} /></td>
                    <td className="fin-wrap">
                      <span className="cell-main">
                        {c.service_names && c.service_names.length > 0
                          ? c.service_names.join(', ')
                          : c.category_name || (c.category_id == null ? (sw ? 'Kategoria haijachaguliwa' : 'Category not selected') : `${sw ? 'Kategoria' : 'Category'} #${c.category_id}`)}
                      </span>
                      {c.service_names && c.service_names.length > 0 && (
                        <span className="cell-sub">{c.category_name || (c.category_id == null ? (sw ? 'Kategoria haijachaguliwa' : 'Category not selected') : `${sw ? 'Kategoria' : 'Category'} #${c.category_id}`)}</span>
                      )}
                      {c.exception_reason && (
                        <span className="cell-sub fin-warn" title={c.exception_reason}>{sw ? 'Dosari' : 'Exception'}</span>
                      )}
                    </td>
                    <td>
                      <span className="fin-stack">
                        {c.work_type === 'COMMUNITY'
                          ? <span className="chip chip-legacy">{sw ? COMMUNITY_SW : 'Community'}</span>
                          : c.work_type && c.work_type !== 'LEGACY' ? <WorkTypeChip type={c.work_type} /> : null}
                        <RouteBadge route={c.route_code} />
                      </span>
                    </td>
                    <td>
                      <StatusBadge kind="claim" status={c.status} bare />
                      {c.central_reviewer_name && <span className="cell-sub">{sw ? 'Mkaguzi wa Fedha Kuu' : 'Central reviewer'}: {c.central_reviewer_name}</span>}
                    </td>
                    <td>
                      <StatusBadge kind="payment" status={c.payment_status} bare />
                    </td>
                    <td className="num">
                      <span className="cell-main">{money(c.amount, c.currency)}</span>
                      <span className="cell-sub">{sw ? 'Kilicholipwa' : 'Paid'} {money(c.amount_paid, c.currency)}</span>
                    </td>
                    <td className="nowrap small">{dateTime(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </AsyncState>

      {(page > 0 || (claims.data?.length || 0) >= 100) && <nav className="row fin-pager" aria-label={sw ? 'Kurasa za madai' : 'Claims pages'}>
        <button className="btn btn-secondary" disabled={claims.loading || page === 0} onClick={() => setPage(page - 1)}>{sw ? 'Madai yaliyotangulia' : 'Previous claims'}</button>
        <span>{sw ? 'Ukurasa' : 'Page'} {page + 1}</span>
        <button className="btn btn-secondary" disabled={claims.loading || (claims.data?.length || 0) < 100} onClick={() => setPage(page + 1)}>{sw ? 'Madai yanayofuata' : 'Next claims'}</button>
      </nav>}

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
