import { useState } from 'react';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { BarList, ChartCard, Ring, StackedBars } from '../components/charts';
import { Icon } from '../components/Icon';
import { Alert, AsyncState, Empty, Field, KpiStrip, StatusBadge } from '../components/ui';
import {
  CADRE_NAMES,
  CLAIM_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  ROUTE_LABELS_SW,
  TIMEZONE,
  WORKLOG_ACTION_LABELS,
  WORKLOG_STATUS_LABELS,
  WORKLOG_STATUS_LABELS_SW,
  cadreName,
  compactMoney,
  dateOnly,
  hoursAge,
  label,
  money,
  num,
  roleLabel,
  todayLocal,
} from '../format';
import { useApi } from '../hooks';
import { Cadre, DashboardData, Named, PayPeriod } from '../types';
import './polish-admin.css';

type Words = { en: string; sw: string };
const say = (w: Words, sw: boolean) => (sw ? w.sw : w.en);

const EXCEPTION_ACTIONS = ['return', 'return_to_reviewer', 'reject', 'reopen', 'decline'];
const EXCEPTION_SW: Record<string, string> = {
  return: 'Kurudishwa kwa mtoa huduma',
  return_to_reviewer: 'Kurudishwa kwa mkaguzi wa awali',
  reject: 'Kukataliwa',
  reopen: 'Kufunguliwa kwa marekebisho',
  decline: 'Mtoa huduma aliripoti tatizo',
};
/** Who owns each review queue, in Kiswahili (wording matches the approval stepper). */
const OWNER_SW: Record<string, string> = {
  SUPERVISOR: 'Mkuu wa CTC / CSO',
  TECHNICAL_OFFICER: 'Afisa wa kitaalamu',
  CSO_TECHNICAL_OFFICER: 'Afisa wa kitaalamu wa CSO',
  RPM: 'Meneja wa kanda (RM)',
  REGIONAL_FINANCE: 'Fedha ya Mkoa',
};
const ROUTES = ['A', 'B', 'C'];
const ROUTE_NAMES: Record<string, string> = { A: 'FHI360 Payment', B: 'CSO Payment · Facility payroll', C: 'CSO Payment · Community', UNROUTED: 'No payment route (exception)' };
const ROUTE_SHORT: Record<string, Words> = {
  A: { en: 'Paid by FHI360', sw: 'Inalipwa na FHI360' },
  B: { en: 'Facility → FHI360 → CSO', sw: 'Kituo → FHI360 → CSO' },
  C: { en: 'Community, paid by CSO', sw: 'Jamii, inalipwa na CSO' },
  UNROUTED: { en: 'Exception', sw: 'Isiyo ya kawaida' },
};
const PIPELINE = [
  'DRAFT',
  'PENDING_CTC_VERIFICATION',
  'PENDING_PROVIDER_OTP_CONFIRMATION',
  'PENDING_TECHNICAL_REVIEW',
  'PENDING_RPM_AUTHORIZATION',
  'PENDING_FINANCE_REVIEW',
  'FINANCE_REVIEWED',
  'ROUTED_FHI360',
  'ROUTED_CSO',
  'RETURNED_TO_PROVIDER',
  'APPROVED',
  'PAID',
  'REJECTED',
];

// Claim lifecycle and payment progress grouped into five stable categories each (fixed color slots).
type Group = { key: string; label: Words; statuses: string[] };
const CLAIM_GROUPS: Group[] = [
  { key: 'preparing', label: { en: 'Preparing', sw: 'Inaandaliwa' }, statuses: ['DRAFT', 'VALIDATION_NEEDED', 'PENDING_COMMUNITY_VERIFICATION'] },
  { key: 'awaiting', label: { en: 'Awaiting approval', sw: 'Inasubiri idhini' }, statuses: ['AWAITING_APPROVAL', 'PENDING_FINANCE_REVIEW', 'PENDING_CENTRAL_REVIEW'] },
  { key: 'approved', label: { en: 'Approved / ready', sw: 'Imeidhinishwa / tayari' }, statuses: ['APPROVED', 'READY'] },
  { key: 'held', label: { en: 'Held', sw: 'Imezuiwa' }, statuses: ['BUDGET_HOLD', 'HELD'] },
  { key: 'exported', label: { en: 'Exported / handed off', sw: 'Imetumwa / imekabidhiwa' }, statuses: ['EXPORTED', 'HANDED_OFF'] },
];
const PAYMENT_GROUPS: Group[] = [
  { key: 'not', label: { en: 'Not yet payable', sw: 'Bado haijalipika' }, statuses: ['NOT_STARTED'] },
  { key: 'pending', label: { en: 'Awaiting payment', sw: 'Inasubiri malipo' }, statuses: ['PENDING'] },
  { key: 'progress', label: { en: 'Partial / proof needed', sw: 'Sehemu / inahitaji uthibitisho' }, statuses: ['PARTIALLY_RECORDED', 'PROOF_REQUIRED'] },
  { key: 'failed', label: { en: 'Failed', sw: 'Imeshindikana' }, statuses: ['FAILED'] },
  { key: 'paid', label: { en: 'Paid / reconciled', sw: 'Imelipwa / imepatanishwa' }, statuses: ['PAID', 'RECONCILED'] },
];

const claimsWord = (count: number, sw: boolean) => (sw ? `madai ${num(count)}` : `${num(count)} claim${count === 1 ? '' : 's'}`);
/** "3 h", "2 d 4 h" in the reader's language. */
const ageText = (hours: number, sw: boolean) => {
  if (!sw) return hoursAge(hours);
  if (hours < 1) return 'chini ya saa 1';
  if (hours < 48) return `saa ${Math.round(hours)}`;
  return `siku ${Math.floor(hours / 24)} saa ${Math.round(hours % 24)}`;
};

type Totals = Record<string, { count: number; amount: number }>;
function grouped(totals: Totals, groups: Group[], sw: boolean) {
  return groups.map((g) => {
    const count = g.statuses.reduce((s, k) => s + (totals[k]?.count || 0), 0);
    const amount = g.statuses.reduce((s, k) => s + (totals[k]?.amount || 0), 0);
    return { key: g.key, label: say(g.label, sw), value: amount, detail: claimsWord(count, sw) };
  });
}

function TotalsTable({ title, totals, kind, labels, sw }: { title: string; totals: Totals; kind: 'claim' | 'payment'; labels: Record<string, string>; sw: boolean }) {
  const order = Object.keys(labels);
  const keys = Object.keys(totals).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!keys.length) return null;
  return (
    <div className="table-wrap">
      <table>
        <caption className="muted small">{title}</caption>
        <thead>
          <tr>
            <th scope="col">{kind === 'claim' ? (sw ? 'Hali ya dai' : 'Claim status') : sw ? 'Hali ya malipo' : 'Payment status'}</th>
            <th scope="col" className="num">
              {sw ? 'Madai' : 'Claims'}
            </th>
            <th scope="col" className="num">
              {sw ? 'Kiasi' : 'Amount'}
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
              <td className="num nowrap">{money(totals[k].amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DashboardBody({ d, periodSelected, sw }: { d: DashboardData; periodSelected: boolean; sw: boolean }) {
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
  const statusName = (s: string) => (sw && WORKLOG_STATUS_LABELS_SW[s]) || label(WORKLOG_STATUS_LABELS, s);
  const ownerName = (o: string) => (sw && OWNER_SW[o]) || roleLabel(o);
  const exceptionName = (a: string) => (sw && EXCEPTION_SW[a]) || label(WORKLOG_ACTION_LABELS, a);
  const routeName = (r: string) => (sw ? ROUTE_LABELS_SW[r] || (r === 'UNROUTED' ? 'Hakuna njia ya malipo' : r) : ROUTE_NAMES[r] || r);
  const pipeline = PIPELINE.filter((s) => d.work_logs.by_status[s]).map((s) => ({ key: s, label: statusName(s), value: d.work_logs.by_status[s] }));
  const routeRow = (r: string) => (
    <span className="row-inline nowrap">
      <span className={`route-dot route-${r}`}>{r === 'UNROUTED' ? '!' : r}</span>
      {r === 'UNROUTED' ? (sw ? 'Hakuna njia ya malipo' : 'No payment route') : routeName(r)}
    </span>
  );
  const routeCaption = (r: string) => `${ROUTE_SHORT[r] ? say(ROUTE_SHORT[r], sw) : ''} · ${claimsWord(d.claims[r].count, sw)}`;
  const noClaims = sw ? 'Hakuna madai yanayolingana na vichujio hivi.' : 'No claims match these filters.';

  return (
    <div className="stack-lg">
      <KpiStrip
        label={sw ? 'Takwimu kuu' : 'Headline figures'}
        items={[
          {
            icon: 'users',
            label: sw ? 'Watumishi walio kazini' : 'Active staff',
            value: num(d.staff.active),
            note: sw ? `${num(d.staff.exited)} wameondoka · ${num(d.staff.total)} jumla` : `${num(d.staff.exited)} exited · ${num(d.staff.total)} total`,
          },
          {
            icon: 'clipboard',
            tone: 'info',
            label: sw ? 'Zinasubiri mapitio' : 'Awaiting review',
            value: num(waiting),
            note: sw ? 'CTC, kitaalamu na RM' : 'CTC, technical and RM stages',
          },
          {
            icon: 'clock',
            tone: late ? 'danger' : 'success',
            label: sw ? `Zimesubiri saa ${reminderHours} au zaidi` : `Waiting ${reminderHours} h or more`,
            value: num(late),
            note: late ? (sw ? 'Zinahitaji kufuatiliwa' : 'Need follow-up') : sw ? 'Foleni zote ziko ndani ya lengo' : 'All queues within target',
          },
          {
            icon: 'receipt',
            tone: 'warn',
            label: sw ? 'Zimeidhinishwa, bado kulipwa' : 'Approved, not yet paid',
            value: compactMoney(Math.max(approvedUnpaid, 0)),
            note: money(Math.max(approvedUnpaid, 0)),
          },
          {
            icon: 'wallet',
            tone: 'success',
            label: sw ? 'Yamelipwa na kurekodiwa' : 'Paid & recorded',
            value: compactMoney(paid),
            note: sw ? 'Imelipwa au imepatanishwa' : 'Paid or Reconciled',
          },
        ]}
      />

      <div className="grid-charts">
        <ChartCard
          title={sw ? 'Mtiririko wa kumbukumbu za kazi' : 'Work-log pipeline'}
          subtitle={sw ? 'Kumbukumbu katika kila hatua' : 'Logs at each step'}
          table={
            <table>
              <thead>
                <tr>
                  <th scope="col">{sw ? 'Hali' : 'Status'}</th>
                  <th scope="col" className="num">
                    {sw ? 'Kumbukumbu' : 'Logs'}
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
          {pipeline.length ? (
            <BarList items={pipeline} unit={sw ? 'kumbukumbu' : 'logs'} />
          ) : (
            <Empty>{sw ? 'Hakuna kumbukumbu za kazi zinazolingana na vichujio hivi.' : 'No work logs match these filters.'}</Empty>
          )}
        </ChartCard>

        <ChartCard
          title={sw ? 'Kazi iliyosubiri muda mrefu zaidi kwa kila foleni' : 'Oldest item per review queue'}
          subtitle={sw ? `Lengo la saa ${reminderHours}` : `${reminderHours}-hour target`}
          table={
            <table>
              <thead>
                <tr>
                  <th scope="col">{sw ? 'Hatua' : 'Stage'}</th>
                  <th scope="col">{sw ? 'Mhusika' : 'Owner'}</th>
                  <th scope="col" className="num">
                    {sw ? 'Zinasubiri' : 'Waiting'}
                  </th>
                  <th scope="col" className="num">
                    {sw ? 'Wastani' : 'Average'}
                  </th>
                  <th scope="col" className="num">
                    {sw ? 'Ya zamani zaidi' : 'Oldest'}
                  </th>
                  <th scope="col" className="num">
                    {sw ? `Saa ${reminderHours} au zaidi` : `${reminderHours} h or more`}
                  </th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.status} className={q.over_threshold ? 'row-over-48' : undefined}>
                    <td>{statusName(q.status)}</td>
                    <td>{ownerName(q.owner)}</td>
                    <td className="num">{num(q.count)}</td>
                    <td className="num nowrap">{q.count ? ageText(q.avg_age_hours, sw) : '—'}</td>
                    <td className="num nowrap">{q.count ? ageText(q.max_age_hours, sw) : '—'}</td>
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
              label: ownerName(q.owner),
              value: q.max_age_hours,
              flagged: q.over_threshold > 0,
              note: (
                <>
                  {sw ? `${num(q.count)} zinasubiri` : `${num(q.count)} waiting`}
                  {q.over_threshold > 0 && (
                    <span className="late-note">
                      <Icon name="alert" size={13} /> {sw ? `${num(q.over_threshold)} zimesubiri saa ${reminderHours}+` : `${num(q.over_threshold)} waiting ${reminderHours} h or more`}
                    </span>
                  )}
                </>
              ),
            }))}
            format={(h) => (h ? ageText(h, sw) : '—')}
            reference={{ value: reminderHours, label: sw ? `saa ${reminderHours}` : `${reminderHours} h` }}
          />
        </ChartCard>

        <ChartCard
          title={sw ? 'Madai kwa njia ya malipo' : 'Claims by route'}
          subtitle={sw ? 'Kiasi kwa hatua, bila yaliyofutwa' : 'Amount by stage, cancelled excluded'}
          table={
            <div className="stack">
              {routes.map((r) => (
                <TotalsTable key={r} title={routeName(r)} totals={d.claims[r].by_status} kind="claim" labels={CLAIM_STATUS_LABELS} sw={sw} />
              ))}
            </div>
          }
        >
          {routes.length ? (
            <StackedBars
              categories={CLAIM_GROUPS.map((g) => ({ key: g.key, label: say(g.label, sw) }))}
              format={compactMoney}
              rows={routes.map((r) => ({ key: r, label: routeRow(r), tipLabel: routeName(r), caption: routeCaption(r), segments: grouped(d.claims[r].by_status, CLAIM_GROUPS, sw) }))}
            />
          ) : (
            <Empty>{noClaims}</Empty>
          )}
        </ChartCard>

        <ChartCard
          title={sw ? 'Maendeleo ya malipo kwa njia' : 'Payment progress by route'}
          subtitle={sw ? 'Kiasi kwa hali ya malipo' : 'Amount by payment status'}
          table={
            <div className="stack">
              {routes.map((r) => (
                <TotalsTable key={r} title={routeName(r)} totals={d.claims[r].by_payment_status} kind="payment" labels={PAYMENT_STATUS_LABELS} sw={sw} />
              ))}
            </div>
          }
        >
          {routes.length ? (
            <StackedBars
              categories={PAYMENT_GROUPS.map((g) => ({ key: g.key, label: say(g.label, sw) }))}
              format={compactMoney}
              rows={routes.map((r) => ({ key: r, label: routeRow(r), tipLabel: routeName(r), caption: routeCaption(r), segments: grouped(d.claims[r].by_payment_status, PAYMENT_GROUPS, sw) }))}
            />
          ) : (
            <Empty>{noClaims}</Empty>
          )}
        </ChartCard>

        <ChartCard
          title={sw ? 'Ukamilifu na marekebisho ya mapitio' : 'Completeness & review exceptions'}
          subtitle={sw ? 'Watumishi wenye kumbukumbu, na mara kazi ilirudishwa' : 'Staff with a log, and how often work was sent back'}
          table={
            <table>
              <tbody>
                <tr>
                  <th scope="row">{sw ? 'Watumishi walio kazini wenye kumbukumbu' : 'Active staff with a work log'}</th>
                  <td className="num">
                    {num(c.with_log)} / {num(c.active_staff)}
                  </td>
                </tr>
                {EXCEPTION_ACTIONS.map((a) => (
                  <tr key={a}>
                    <th scope="row">{exceptionName(a)}</th>
                    <td className="num">{num(d.work_logs.exceptions[a] || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          footer={!periodSelected && <span className="muted small">{sw ? 'Chagua kipindi cha malipo kuhesabu kumbukumbu zinazokosekana.' : 'Select a pay period to count missing logs.'}</span>}
        >
          <div className="split">
            <Ring value={c.with_log} total={c.active_staff} label={sw ? 'watumishi wenye kumbukumbu' : 'staff with a log'} />
            <BarList items={EXCEPTION_ACTIONS.map((a) => ({ key: a, label: exceptionName(a), value: d.work_logs.exceptions[a] || 0 }))} unit={sw ? 'mara' : 'times'} />
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

function greeting(sw: boolean): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TIMEZONE }).format(new Date()));
  if (sw) return hour < 12 ? 'Habari za asubuhi' : hour < 16 ? 'Habari za mchana' : 'Habari za jioni';
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const { me, lang } = useAuth();
  const sw = lang !== 'en';
  const [periodId, setPeriodId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [cadre, setCadre] = useState('');
  const [route, setRoute] = useState('');
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const regions = useApi<Named[]>('/admin/regions');
  const cadres = useApi<Cadre[]>('/admin/cadres');
  const dash = useApi<DashboardData>(`/dashboard${qs({ period_id: periodId, region_id: regionId, cadre, route })}`);
  const lookupError = periods.error || regions.error || cadres.error;
  const filtered = !!(periodId || regionId || cadre || route);
  // Health workers are greeted by first name; office accounts ("System Administrator") by their full account name.
  const name = me ? (me.staff ? me.full_name.split(/\s+/).find((part) => part !== 'DEMO') || me.full_name : me.full_name.replace(/^DEMO\s+/, '')) : '';
  const clear = () => {
    setPeriodId('');
    setRegionId('');
    setCadre('');
    setRoute('');
  };

  return (
    <div className="stack-lg dash">
      <div className="hero-header dash-head">
        <div>
          <p className="eyebrow">
            {greeting(sw)}
            {name ? `, ${name}` : ''}
          </p>
          <h1>{sw ? 'Muhtasari wa programu' : 'Programme overview'}</h1>
          <p className="muted dash-sub">
            {sw ? 'Idhini, madai na maendeleo ya malipo' : 'Approvals, claims and payment progress'} · {dateOnly(todayLocal())}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={dash.reload} disabled={dash.loading}>
          <Icon name="refresh" size={16} /> {dash.loading ? (sw ? 'Inapakia…' : 'Refreshing…') : sw ? 'Pakia upya' : 'Refresh'}
        </button>
      </div>

      <div className="card dash-filters" role="group" aria-label={sw ? 'Vichujio' : 'Filters'}>
        <Field label={sw ? 'Kipindi cha malipo' : 'Pay period'}>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">{sw ? 'Vipindi vyote' : 'All periods'}</option>
            {(periods.data || []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.period_label || `${p.start_date} – ${p.end_date}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label={sw ? 'Mkoa' : 'Region'}>
          <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            <option value="">{sw ? 'Mikoa yote' : 'All regions'}</option>
            {(regions.data || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={sw ? 'Kada' : 'Cadre'}>
          <select value={cadre} onChange={(e) => setCadre(e.target.value)} title={sw ? 'Inachuja watumishi na kumbukumbu za kazi' : 'Filters staff and work logs'}>
            <option value="">{sw ? 'Kada zote' : 'All cadres'}</option>
            {(cadres.data || []).map((c) => (
              <option key={c.code} value={c.code}>
                {CADRE_NAMES[c.code] ? cadreName(c.code, lang) : c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={sw ? 'Njia ya malipo' : 'Payment'}>
          <select value={route} onChange={(e) => setRoute(e.target.value)} title={sw ? 'Inachuja madai' : 'Filters claims'}>
            <option value="">{sw ? 'Malipo yote' : 'All payments'}</option>
            {ROUTES.map((r) => (
              <option key={r} value={r}>
                {(sw && ROUTE_LABELS_SW[r]) || ROUTE_NAMES[r] || r}
              </option>
            ))}
          </select>
        </Field>
        {filtered && (
          <button type="button" className="btn btn-ghost dash-clear" onClick={clear}>
            {sw ? 'Ondoa vichujio' : 'Clear filters'}
          </button>
        )}
      </div>
      <Alert kind="warn">{lookupError ? `${sw ? 'Baadhi ya chaguo za vichujio hazikupakia' : 'Some filter options could not be loaded'}: ${lookupError}` : null}</Alert>

      <AsyncState data={dash.data} error={dash.error} loading={dash.loading}>
        {(d) => <DashboardBody d={d} periodSelected={!!periodId} sw={sw} />}
      </AsyncState>
    </div>
  );
}
