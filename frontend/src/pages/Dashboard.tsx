import React, { useState } from 'react';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { BarList, ChartCard, Ring, StackedBars } from '../components/charts';
import { Icon } from '../components/Icon';
import { Alert, AsyncState, Empty, Field, StatusBadge } from '../components/ui';
import {
  CLAIM_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  WORKLOG_ACTION_LABELS,
  WORKLOG_STATUS_LABELS,
  compactMoney,
  hoursAge,
  label,
  money,
  num,
  roleLabel,
} from '../format';
import { useApi } from '../hooks';
import { Cadre, DashboardData, Named, PayPeriod } from '../types';

const EXCEPTION_ACTIONS = ['return', 'return_to_reviewer', 'reject', 'reopen', 'decline'];
const ROUTES = ['A', 'B', 'C'];
const ROUTE_NAMES: Record<string, string> = { A: 'FHI360 Payment', B: 'CSO Payment · Facility payroll', C: 'CSO Payment · Community', UNROUTED: 'No payment route (exception)' };
const ROUTE_SHORT: Record<string, string> = { A: 'Paid by FHI360', B: 'Facility → FHI360 → CSO', C: 'Community, paid by CSO', UNROUTED: 'Exception' };
const PIPELINE = [
  'DRAFT',
  'PENDING_CTC_VERIFICATION',
  'PENDING_PROVIDER_OTP_CONFIRMATION',
  'PENDING_TECHNICAL_REVIEW',
  'PENDING_RPM_AUTHORIZATION',
  'RETURNED_TO_PROVIDER',
  'APPROVED',
  'REJECTED',
];

// Claim lifecycle and payment progress grouped into five stable categories each (fixed color slots).
const CLAIM_GROUPS = [
  { key: 'preparing', label: 'Preparing', statuses: ['DRAFT', 'VALIDATION_NEEDED', 'PENDING_COMMUNITY_VERIFICATION'] },
  { key: 'awaiting', label: 'Awaiting approval', statuses: ['AWAITING_APPROVAL'] },
  { key: 'approved', label: 'Approved / ready', statuses: ['APPROVED', 'READY'] },
  { key: 'held', label: 'Held', statuses: ['BUDGET_HOLD', 'HELD'] },
  { key: 'exported', label: 'Exported / handed off', statuses: ['EXPORTED', 'HANDED_OFF'] },
];
const PAYMENT_GROUPS = [
  { key: 'not', label: 'Not yet payable', statuses: ['NOT_STARTED'] },
  { key: 'pending', label: 'Awaiting payment', statuses: ['PENDING'] },
  { key: 'progress', label: 'Partial / proof needed', statuses: ['PARTIALLY_RECORDED', 'PROOF_REQUIRED'] },
  { key: 'failed', label: 'Failed', statuses: ['FAILED'] },
  { key: 'paid', label: 'Paid / reconciled', statuses: ['PAID', 'RECONCILED'] },
];

type Totals = Record<string, { count: number; amount: number }>;
function grouped(totals: Totals, groups: typeof CLAIM_GROUPS) {
  return groups.map((g) => {
    const count = g.statuses.reduce((s, k) => s + (totals[k]?.count || 0), 0);
    const amount = g.statuses.reduce((s, k) => s + (totals[k]?.amount || 0), 0);
    return { key: g.key, label: g.label, value: amount, detail: `${num(count)} claim${count === 1 ? '' : 's'}` };
  });
}

function Kpi({ icon, label: text, value, hint, tone }: { icon: string; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'warn' | 'danger' | 'success' }) {
  return (
    <div className={`kpi card${tone ? ` kpi-${tone}` : ''}`}>
      <span className="kpi-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <div>
        <div className="kpi-label">{text}</div>
        <div className="kpi-value">{value}</div>
        {hint && <div className="kpi-hint">{hint}</div>}
      </div>
    </div>
  );
}

function TotalsTable({ title, totals, kind, labels }: { title: string; totals: Totals; kind: 'claim' | 'payment'; labels: Record<string, string> }) {
  const order = Object.keys(labels);
  const keys = Object.keys(totals).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!keys.length) return null;
  return (
    <div className="table-wrap">
      <table>
        <caption className="muted small">{title}</caption>
        <thead>
          <tr>
            <th scope="col">{kind === 'claim' ? 'Claim status' : 'Payment status'}</th>
            <th scope="col" className="num">
              Claims
            </th>
            <th scope="col" className="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td>
                <StatusBadge status={k} kind={kind} bare />
              </td>
              <td className="num">{num(totals[k].count)}</td>
              <td className="num">{money(totals[k].amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DashboardBody({ d, periodSelected }: { d: DashboardData; periodSelected: boolean }) {
  const queues = d.work_logs.queues;
  const reminderHours = d.work_logs.reminder_after_hours;
  const waiting = queues.reduce((s, q) => s + q.count, 0);
  const late = queues.reduce((s, q) => s + q.over_threshold, 0);
  const routes = Object.keys(d.claims).sort();
  const paid = routes.reduce((s, r) => s + ['PAID', 'RECONCILED'].reduce((x, k) => x + (d.claims[r].by_payment_status[k]?.amount || 0), 0), 0);
  const approvedUnpaid = routes.reduce(
    (s, r) => s + ['APPROVED', 'READY', 'EXPORTED', 'HANDED_OFF'].reduce((x, k) => x + (d.claims[r].by_status[k]?.amount || 0), 0),
    0,
  ) - paid;
  const c = d.work_logs.completeness;
  const pipeline = PIPELINE.filter((s) => d.work_logs.by_status[s]).map((s) => ({ key: s, label: label(WORKLOG_STATUS_LABELS, s), value: d.work_logs.by_status[s] }));
  const routeRow = (r: string) => (
    <span className="row-inline nowrap">
      <span className={`route-dot route-${r}`}>{r === 'UNROUTED' ? '!' : r}</span>
      {r === 'UNROUTED' ? 'No payment route' : ROUTE_NAMES[r]}
    </span>
  );
  const routeCaption = (r: string) => `${ROUTE_SHORT[r] || ''} · ${num(d.claims[r].count)} claim${d.claims[r].count === 1 ? '' : 's'}`;

  return (
    <div className="stack-lg">
      <div className="kpis">
        <Kpi icon="users" label="Active staff" value={num(d.staff.active)} hint={`${num(d.staff.exited)} exited · ${num(d.staff.total)} total`} />
        <Kpi icon="clipboard" label="Awaiting review" value={num(waiting)} hint="Across CTC, technical and RM stages" />
        <Kpi icon="clock" label={`Waiting ${reminderHours} h or more`} value={num(late)} tone={late ? 'danger' : 'success'} hint={late ? 'Reminder checks run hourly' : 'All queues within target'} />
        <Kpi icon="receipt" label="Approved, not yet paid" value={compactMoney(Math.max(approvedUnpaid, 0))} hint="Liabilities still moving to payment" />
        <Kpi icon="wallet" label="Paid & recorded" value={compactMoney(paid)} tone="success" hint="Payment status Paid or Reconciled" />
        <Kpi icon="receipt" label="Services rate basis" value="Fixed daily amount" hint="Highest eligible service amount per day" />
      </div>

      <div className="grid-charts">
        <ChartCard
          title="Work-log pipeline"
          subtitle="Logs currently at each step. Every cadre follows the same order."
          table={
            <table>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Logs
                  </th>
                </tr>
              </thead>
              <tbody>
                {pipeline.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td className="num">{num(p.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          {pipeline.length ? <BarList items={pipeline} unit="logs" /> : <Empty>No work logs match these filters.</Empty>}
        </ChartCard>

        <ChartCard
          title="Oldest item per review queue"
          subtitle={`Against the ${reminderHours}-hour reminder threshold.`}
          table={
            <table>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Owner</th>
                  <th scope="col" className="num">
                    Waiting
                  </th>
                  <th scope="col" className="num">
                    Average
                  </th>
                  <th scope="col" className="num">
                    Oldest
                  </th>
                  <th scope="col" className="num">
                    {reminderHours} h or more
                  </th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.status} className={q.over_threshold ? 'row-over-48' : undefined}>
                    <td>{label(WORKLOG_STATUS_LABELS, q.status)}</td>
                    <td>{roleLabel(q.owner)}</td>
                    <td className="num">{num(q.count)}</td>
                    <td className="num">{q.count ? hoursAge(q.avg_age_hours) : '—'}</td>
                    <td className="num">{q.count ? hoursAge(q.max_age_hours) : '—'}</td>
                    <td className="num">{num(q.over_threshold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <BarList
            items={queues.map((q) => ({
              key: q.status,
              label: roleLabel(q.owner),
              value: q.max_age_hours,
              flagged: q.over_threshold > 0,
              note: (
                <>
                  {num(q.count)} waiting
                  {q.over_threshold > 0 && (
                    <span className="late-note">
                      <Icon name="alert" size={13} /> {num(q.over_threshold)} waiting {reminderHours} h or more
                    </span>
                  )}
                </>
              ),
            }))}
            format={(h) => (h ? hoursAge(h) : '—')}
            reference={{ value: reminderHours, label: `${reminderHours} h` }}
          />
        </ChartCard>

        <ChartCard
          title="Claims by route"
          subtitle="Claim amount by where each claim is in approval and export (cancelled excluded)."
          table={
            <div className="stack">
              {routes.map((r) => (
                <TotalsTable key={r} title={ROUTE_NAMES[r] || r} totals={d.claims[r].by_status} kind="claim" labels={CLAIM_STATUS_LABELS} />
              ))}
            </div>
          }
        >
          {routes.length ? (
            <StackedBars
              categories={CLAIM_GROUPS}
              format={compactMoney}
              rows={routes.map((r) => ({ key: r, label: routeRow(r), tipLabel: ROUTE_NAMES[r] || r, caption: routeCaption(r), segments: grouped(d.claims[r].by_status, CLAIM_GROUPS) }))}
            />
          ) : (
            <Empty>No claims match these filters.</Empty>
          )}
        </ChartCard>

        <ChartCard
          title="Payment progress by route"
          subtitle="Payment status is separate from claim status: only Paid / reconciled means money was recorded as paid."
          table={
            <div className="stack">
              {routes.map((r) => (
                <TotalsTable key={r} title={ROUTE_NAMES[r] || r} totals={d.claims[r].by_payment_status} kind="payment" labels={PAYMENT_STATUS_LABELS} />
              ))}
            </div>
          }
        >
          {routes.length ? (
            <StackedBars
              categories={PAYMENT_GROUPS}
              format={compactMoney}
              rows={routes.map((r) => ({ key: r, label: routeRow(r), tipLabel: ROUTE_NAMES[r] || r, caption: routeCaption(r), segments: grouped(d.claims[r].by_payment_status, PAYMENT_GROUPS) }))}
            />
          ) : (
            <Empty>No claims match these filters.</Empty>
          )}
        </ChartCard>

        <ChartCard
          title="Completeness & review exceptions"
          subtitle="How many active staff have a log, and how often reviewers sent logs back."
          table={
            <table>
              <tbody>
                <tr>
                  <th scope="row">Active staff with a work log</th>
                  <td className="num">
                    {num(c.with_log)} / {num(c.active_staff)}
                  </td>
                </tr>
                {EXCEPTION_ACTIONS.map((a) => (
                  <tr key={a}>
                    <th scope="row">{label(WORKLOG_ACTION_LABELS, a)}</th>
                    <td className="num">{num(d.work_logs.exceptions[a] || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          footer={!periodSelected && <span className="muted small">Select a pay period to count missing logs.</span>}
        >
          <div className="split">
            <Ring value={c.with_log} total={c.active_staff} label="staff with a log" />
            <BarList items={EXCEPTION_ACTIONS.map((a) => ({ key: a, label: label(WORKLOG_ACTION_LABELS, a), value: d.work_logs.exceptions[a] || 0 }))} unit="times" />
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Dar_es_Salaam' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const { me } = useAuth();
  const [periodId, setPeriodId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [cadre, setCadre] = useState('');
  const [route, setRoute] = useState('');
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const regions = useApi<Named[]>('/admin/regions');
  const cadres = useApi<Cadre[]>('/admin/cadres');
  const dash = useApi<DashboardData>(`/dashboard${qs({ period_id: periodId, region_id: regionId, cadre, route })}`);
  const lookupError = periods.error || regions.error || cadres.error;

  return (
    <div className="stack-lg">
      <div className="hero-header">
        <div>
          <p className="eyebrow">{greeting()}, {me?.full_name.split(' ')[0]}</p>
          <h1>Programme overview</h1>
          <p className="muted">Every figure covers only the staff, work logs and claims you are allowed to see.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={dash.reload} disabled={dash.loading}>
          <Icon name="refresh" size={16} /> {dash.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="filters card filter-bar">
        <Field label="Pay period">
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">All periods</option>
            {(periods.data || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_label || `${p.start_date} – ${p.end_date}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Region">
          <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            <option value="">All regions</option>
            {(regions.data || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cadre" hint="Staff and work logs">
          <select value={cadre} onChange={(e) => setCadre(e.target.value)}>
            <option value="">All cadres</option>
            {(cadres.data || []).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment" hint="Claims">
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="">All payments</option>
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {ROUTE_NAMES[r] || r}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Alert kind="warn">{lookupError ? `Some filter options could not be loaded: ${lookupError}` : null}</Alert>

      <AsyncState data={dash.data} error={dash.error} loading={dash.loading}>
        {(d) => <DashboardBody d={d} periodSelected={!!periodId} />}
      </AsyncState>
    </div>
  );
}
