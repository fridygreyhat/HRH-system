import React from 'react';
import { useAuth } from '../AuthContext';
import { Icon, IconName } from '../components/Icon';
import { Kpi, KpiStrip, PersonCell, StatusBadge, WorkTypeChip } from '../components/ui';
import {
  dateOnly, label, money, num, payMonth, payMonthRange, TIMEZONE, todayLocal, workHours, workTypeName,
  WORKLOG_STATUS_LABELS, WORKLOG_STATUS_LABELS_SW,
} from '../format';
import { useApi } from '../hooks';
import { navigate } from '../nav';
import { ClaimSummary, Me, PayPeriod, RoutingQueueItem, WorkLogSummary } from '../types';
import { workMonthLabel } from './workLogStart';
import './polish-provider.css';

type Lang = 'en' | 'sw';

interface Task {
  key: string;
  page: string;
  target?: string;
  icon: string;
  roles: string[];
  title: Record<Lang, string>;
  hint: Record<Lang, string>;
  /** Where the live number comes from. Left out for a plain shortcut. */
  count?: { path: string; pick?: (rows: any[], me: Me) => number };
}

const REVIEW = ['SUPERVISOR', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM'];
const STAFF_ADMINS = ['CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'SYSTEM_ADMIN'];
const NEEDS_CORRECTION = ['RETURNED_TO_PROVIDER', 'REJECTED'];
const WITH_REVIEWERS = ['PENDING_CTC_VERIFICATION', 'PENDING_TECHNICAL_REVIEW', 'PENDING_RPM_AUTHORIZATION'];
/** The same rule the CSO portal uses for its "Pending payments" tab. */
const CSO_PENDING = ['PENDING', 'PARTIALLY_RECORDED', 'PROOF_REQUIRED', 'FAILED'];
const csoPending = (row: any) => CSO_PENDING.includes(row.payment_status) ||
  (row.workflow_version === 2 && row.status === 'READY' && row.payment_status !== 'PAID' && row.payment_status !== 'RECONCILED');

// Every list Home reads. Each one is the endpoint the matching work page already uses.
const MINE = '/worklogs?mine=true';
const PERIODS = '/admin/pay-periods';
const QUEUE_PAYROLL = '/worklogs?queue=true&work_type=PAYROLL';
const QUEUE_SERVICES = '/worklogs?queue=true&work_type=SERVICES';
const ROUTING = '/finance/pending-routing?work_type=SERVICES';
const CLAIMS = '/claims';
const COMMUNITY = '/claims?work_type=COMMUNITY';
const CHANGES = '/staff/change-requests';

/** Ordered by what a person most needs to do. Each one opens the exact place to do it, in one click. */
const TASKS: Task[] = [
  {
    key: 'my-timesheet', page: 'my-logs', icon: 'calendar', roles: ['PROVIDER'],
    title: { en: 'Fill in my timesheet', sw: 'Jaza jedwali langu' },
    hint: { en: 'Record your days, then submit on the 25th', sw: 'Rekodi siku zako, kisha wasilisha tarehe 25' },
  },
  {
    key: 'my-corrections', page: 'my-logs', icon: 'alert', roles: ['PROVIDER'],
    title: { en: 'Needs my correction', sw: 'Inahitaji marekebisho yangu' },
    hint: { en: 'Timesheets sent back to you', sw: 'Majedwali yaliyorudishwa kwako' },
    count: { path: MINE, pick: rows => rows.filter(row => NEEDS_CORRECTION.includes(row.status)).length },
  },
  {
    key: 'review-payroll', page: 'worklogs', target: 'PAYROLL', icon: 'clipboard', roles: REVIEW,
    title: { en: 'Payroll timesheets', sw: 'Majedwali ya Payroll' },
    hint: { en: 'Waiting for your decision', sw: 'Yanasubiri uamuzi wako' },
    count: { path: QUEUE_PAYROLL },
  },
  {
    key: 'review-services', page: 'worklogs', target: 'SERVICES', icon: 'clipboard', roles: REVIEW,
    title: { en: 'Services timesheets', sw: 'Majedwali ya Huduma' },
    hint: { en: 'Waiting for your decision', sw: 'Yanasubiri uamuzi wako' },
    count: { path: QUEUE_SERVICES },
  },
  {
    key: 'facility-timesheets', page: 'worklogs', icon: 'clipboard', roles: ['FACILITY_IN_CHARGE'],
    title: { en: "My facility's timesheets", sw: 'Majedwali ya kituo changu' },
    hint: { en: 'Read every cadre at your facility', sw: 'Soma kila kada katika kituo chako' },
  },
  {
    key: 'finance-services', page: 'routing-queue', icon: 'route', roles: ['REGIONAL_FINANCE'],
    title: { en: 'Services to review', sw: 'Huduma za kukagua' },
    hint: { en: 'Approve, then send to Central Finance', sw: 'Idhinisha, kisha tuma Fedha Kuu' },
    count: { path: ROUTING },
  },
  {
    key: 'finance-report', page: 'finance-monthly', icon: 'pie', roles: ['REGIONAL_FINANCE'],
    title: { en: 'Monthly report to sign', sw: 'Ripoti ya mwezi ya kusaini' },
    hint: { en: 'Sign the Payroll report', sw: 'Saini ripoti ya Payroll' },
  },
  {
    key: 'central-prf', page: 'claims', icon: 'wallet', roles: ['FHI360_FINANCE'],
    title: { en: 'PRF and proof of payment', sw: 'PRF na uthibitisho wa malipo' },
    hint: { en: 'Download, record the PRF, upload proof', sw: 'Pakua, rekodi PRF, pakia uthibitisho' },
  },
  {
    key: 'central-claims', page: 'claims', icon: 'receipt', roles: ['FHI360_FINANCE'],
    title: { en: 'Services for your approval', sw: 'Huduma za idhini yako' },
    hint: { en: 'Assigned to you by Regional Finance', sw: 'Umepewa na Fedha ya Mkoa' },
    count: { path: CLAIMS, pick: (rows, me) => rows.filter(row => row.status === 'PENDING_CENTRAL_REVIEW' && row.central_reviewer_id === me.id).length },
  },
  {
    key: 'salary-files', page: 'cso', target: 'salary', icon: 'wallet', roles: ['CSO_FINANCE'],
    title: { en: 'Salary timesheets', sw: 'Majedwali ya mishahara' },
    hint: { en: 'Download signed salary files', sw: 'Pakua mishahara iliyosainiwa' },
  },
  {
    key: 'cso-payments', page: 'cso', icon: 'receipt', roles: ['CSO_FINANCE'],
    title: { en: 'CSO payments', sw: 'Malipo ya CSO' },
    hint: { en: 'Record payments and upload proof', sw: 'Rekodi malipo na pakia uthibitisho' },
    count: { path: CLAIMS, pick: rows => rows.filter(csoPending).length },
  },
  {
    key: 'community-verify', page: 'community-claims', icon: 'users', roles: ['COMMUNITY_VERIFIER'],
    title: { en: 'Community claims', sw: 'Madai ya jamii' },
    hint: { en: 'Confirm that the service was delivered', sw: 'Thibitisha kuwa huduma ilitolewa' },
    count: { path: COMMUNITY, pick: rows => rows.filter(row => row.status === 'PENDING_COMMUNITY_VERIFICATION').length },
  },
  {
    key: 'staff-changes', page: 'staff', icon: 'shield', roles: ['CENTRAL_ADMIN', 'SYSTEM_ADMIN'],
    title: { en: 'Staff changes to decide', sw: 'Mabadiliko ya watumishi ya kuamua' },
    hint: { en: 'Payment details waiting for a second admin', sw: 'Taarifa za malipo zinasubiri msimamizi wa pili' },
    count: { path: CHANGES },
  },
  {
    key: 'staff-registry', page: 'staff', icon: 'users', roles: STAFF_ADMINS,
    title: { en: 'Staff registry', sw: 'Daftari la watumishi' },
    hint: { en: 'Add staff and placements', sw: 'Ongeza watumishi na vituo vyao' },
  },
  {
    key: 'users', page: 'admin', icon: 'settings', roles: ['SYSTEM_ADMIN'],
    title: { en: 'Users and settings', sw: 'Watumiaji na mipangilio' },
    hint: { en: 'Create logins, roles and scopes', sw: 'Unda akaunti, majukumu na maeneo' },
  },
  {
    key: 'overview', page: 'dashboard', icon: 'dashboard', roles: ['OVERSIGHT'],
    title: { en: 'Programme dashboard', sw: 'Dashibodi ya mpango' },
    hint: { en: 'Progress across regions and payors', sw: 'Maendeleo katika mikoa na walipaji' },
  },
];

interface SetupStep {
  key: string;
  page: string;
  roles: string[];
  path: string;
  done: (data: any) => boolean;
  title: Record<Lang, string>;
  hint?: Record<Lang, string>;
}

/** The order a new system has to be set up in. Each step checks the real data, so it ticks itself. */
const SETUP: SetupStep[] = [
  {
    key: 'cso', page: 'organizations', roles: ['CENTRAL_ADMIN', 'SUPER_ADMIN'], path: '/organizations', done: data => (data.organizations || []).some((org: any) => org.type === 'CSO'),
    title: { en: 'Add your CSOs and link their regions', sw: 'Ongeza CSO na uunganishe mikoa yao' },
  },
  {
    key: 'users', page: 'admin', roles: ['SYSTEM_ADMIN', 'SUPER_ADMIN'], path: '/admin/users', done: data => data.length > 1,
    title: { en: 'Create the reviewer logins', sw: 'Unda akaunti za wakaguzi' },
    hint: { en: 'CTC, Technical, RM, Finance and a second admin', sw: 'CTC, Kitaalamu, RM, Fedha na msimamizi wa pili' },
  },
  {
    key: 'services', page: 'rates', roles: ['SUPER_ADMIN'], path: '/rates', done: data => data.length > 0,
    title: { en: 'Add services and their minimum days', sw: 'Ongeza huduma na siku zake za chini' },
    hint: { en: 'Index 10, SNS 5 and Mobile 10 days a month', sw: 'Index 10, SNS 5 na Mobile siku 10 kwa mwezi' },
  },
  {
    key: 'salaries', page: 'salary-amounts', roles: ['SUPER_ADMIN'], path: `/salary-amounts?month=${payMonth(todayLocal())}`, done: data => data.some((row: any) => row.monthly_amount),
    title: { en: 'Set a salary for each scale', sw: 'Weka mshahara wa kila ngazi' },
  },
  {
    key: 'staff', page: 'staff', roles: ['CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'SUPER_ADMIN'], path: '/staff', done: data => data.length > 0,
    title: { en: 'Register your providers', sw: 'Sajili watoa huduma wako' },
    hint: { en: 'Add one by one or import a roster', sw: 'Mmoja mmoja au pakia orodha' },
  },
];

function SetupRow({ step, number, lang, onState }: { step: SetupStep; number: number; lang: Lang; onState: (key: string, done: boolean) => void }) {
  const { data, error } = useApi<any>(step.path);
  const done = data ? step.done(data) : false;
  React.useEffect(() => { if (data) onState(step.key, done); }, [data, done]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return null;
  return (
    <li className={`setup-row${done ? ' is-done' : ''}`}>
      <button type="button" onClick={() => navigate(step.page)}>
        <span className="setup-mark">{done ? '✓' : number}</span>
        <span className="task-text">
          <span className="task-title">{step.title[lang]}</span>
          {step.hint && <span className="task-hint">{step.hint[lang]}</span>}
        </span>
        <Icon name="chevron" size={18} className="task-arrow" />
      </button>
    </li>
  );
}

function SetupChecklist({ lang, steps }: { lang: Lang; steps: SetupStep[] }) {
  const [state, setState] = React.useState<Record<string, boolean>>({});
  const update = React.useCallback((key: string, done: boolean) => setState(current => ({ ...current, [key]: done })), []);
  const finished = steps.filter(step => state[step.key]).length;
  const percent = Math.round((finished / steps.length) * 100);
  if (steps.length && finished === steps.length) return null;
  return (
    <section className="card setup" aria-labelledby="setup-title">
      <div className="row-between">
        <h2 id="setup-title">{lang === 'sw' ? 'Andaa mfumo wako' : 'Set up your system'}</h2>
        <span className="setup-count">{finished} / {steps.length}</span>
      </div>
      <div className="target-bar" role="progressbar" aria-label={lang === 'sw' ? 'Maendeleo ya maandalizi' : 'Setup progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="target-fill setup-fill" style={{ width: `${percent}%` }} />
      </div>
      <ol className="setup-list">
        {steps.map((step, index) => <SetupRow key={step.key} step={step} number={index + 1} lang={lang} onState={update} />)}
      </ol>
    </section>
  );
}

function greeting(lang: Lang): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TIMEZONE }).format(new Date()));
  if (lang === 'sw') return hour < 12 ? 'Habari za asubuhi' : hour < 16 ? 'Habari za mchana' : 'Habari za jioni';
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** Where today sits in the 26th-to-25th month, so everyone knows the deadline without counting. */
export function monthProgress(today: string) {
  const month = payMonth(today);
  const { first, last } = payMonthRange(month);
  const total = dayNumber(last) - dayNumber(first) + 1;
  const passed = dayNumber(today) - dayNumber(first) + 1;
  return { month, last, left: total - passed, percent: Math.round((passed / total) * 100) };
}

type Rows = Record<string, any[] | null>;

function TaskCard({ task, lang, me, rows }: { task: Task; lang: Lang; me: Me; rows: Rows }) {
  const data = task.count ? rows[task.count.path] : null;
  const count = task.count && data ? (task.count.pick ? task.count.pick(data, me) : data.length) : null;
  const clear = count === 0;
  return (
    <button
      type="button"
      className={`task-card${count ? ' has-work' : ''}${clear ? ' is-clear' : ''}`}
      onClick={() => navigate(task.page, task.target)}
    >
      <span className="task-icon"><Icon name={task.icon} /></span>
      <span className="task-text">
        <span className="task-title">{task.title[lang]}</span>
        <span className="task-hint">{task.hint[lang]}</span>
      </span>
      {count !== null && (clear
        ? <span className="task-done">{lang === 'sw' ? 'Hakuna' : 'All clear'}</span>
        : <span className="task-count">{num(count)}</span>)}
      <Icon name="chevron" size={18} className="task-arrow" />
    </button>
  );
}

const hoursText = (value: number | string, sw: boolean) => {
  const text = workHours(value);
  return /^[\d,]+$/.test(text) ? (sw ? `saa ${text}` : `${text} h`) : text;
};
const daysText = (value: number, sw: boolean) => (sw ? `Siku ${num(value)}` : `${num(value)} ${value === 1 ? 'day' : 'days'}`);
const statusText = (status: string, sw: boolean) => (sw && WORKLOG_STATUS_LABELS_SW[status]) || label(WORKLOG_STATUS_LABELS, status);
const waitedText = (hours: number, sw: boolean) => {
  if (hours < 1) return sw ? 'chini ya saa 1' : 'under 1 h';
  if (hours < 48) return sw ? `saa ${Math.round(hours)}` : `${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.floor(hours % 24);
  return sw ? `siku ${days} saa ${rest}` : `${days} d ${rest} h`;
};
const statusTone = (status: string): Kpi['tone'] =>
  NEEDS_CORRECTION.includes(status) ? 'danger' : status === 'DRAFT' ? 'neutral' : ['APPROVED', 'PAID', 'FINANCE_REVIEWED', 'ROUTED_FHI360', 'ROUTED_CSO'].includes(status) ? 'success' : 'info';
const sumAmount = (rows: { amount: number | string | null; currency?: string | null }[]) => {
  const priced = rows.filter(row => row.amount !== null && row.amount !== undefined && row.currency);
  const currencies = new Set(priced.map(row => row.currency));
  if (!priced.length || currencies.size !== 1) return null;
  return money(priced.reduce((sum, row) => sum + Number(row.amount), 0), priced[0].currency as string);
};

/** A month label for a log, from its schedule's dates. */
function logMonth(log: WorkLogSummary, periods: PayPeriod[], lang: Lang): string {
  const period = periods.find(p => p.id === log.period_id);
  if (!period) return log.period_label || (lang === 'sw' ? 'Rekodi ya mwezi' : 'Monthly record');
  const start = payMonth(period.start_date);
  const end = payMonth(period.end_date);
  return start === end ? workMonthLabel(start, lang) : `${workMonthLabel(start, lang)} – ${workMonthLabel(end, lang)}`;
}

interface Summary {
  lead?: string;
  kpis: Kpi[];
  kpiLabel: string;
  list?: { title: string; items: React.ReactNode[]; more?: { label: string; page: string } };
}

/** The numbers and the short list each role needs first, all from the lists Home already reads. */
function summaries(rows: Rows, me: Me, has: (...roles: string[]) => boolean, lang: Lang, monthName: string): Summary[] {
  const sw = lang === 'sw';
  const out: Summary[] = [];

  const mine = rows[MINE] as WorkLogSummary[] | null;
  const periods = (rows[PERIODS] || []) as PayPeriod[];
  if (has('PROVIDER') && mine) {
    const live = mine.filter(log => log.status !== 'CANCELLED');
    const { first, last } = payMonthRange(payMonth(todayLocal()));
    const thisMonthPeriods = new Set(periods.filter(p => p.status !== 'ARCHIVED' && p.start_date <= last && p.end_date >= first).map(p => p.id));
    const current = live.filter(log => thisMonthPeriods.has(log.period_id));
    const correcting = live.filter(log => NEEDS_CORRECTION.includes(log.status));
    const reviewing = live.filter(log => WITH_REVIEWERS.includes(log.status));
    const paid = live.filter(log => log.status === 'PAID').sort((a, b) => b.id - a.id);
    const kpis: Kpi[] = current.length
      ? current.slice(0, 2).map(log => ({
        label: sw ? `${workTypeName(log.work_type, lang)} mwezi huu` : `${workTypeName(log.work_type, lang)} this month`,
        value: daysText(log.entry_count, sw),
        note: `${hoursText(log.total_hours, sw)} · ${statusText(log.status, sw)}`,
        tone: statusTone(log.status), icon: 'calendar' as IconName, onClick: () => navigate('my-logs'),
      }))
      : [{
        label: sw ? 'Mwezi huu' : 'This month', value: sw ? 'Bado' : 'Not started',
        note: sw ? 'Anza jedwali lako' : 'Start your timesheet', tone: 'warn', icon: 'calendar', onClick: () => navigate('my-logs'),
      }];
    kpis.push(
      { label: sw ? 'Kwa wakaguzi' : 'With reviewers', value: num(reviewing.length), tone: 'info', icon: 'clock', onClick: () => navigate('my-logs') },
      {
        label: sw ? 'Zilizolipwa' : 'Paid', value: num(paid.length), tone: 'success', icon: 'wallet', onClick: () => navigate('my-logs'),
        note: paid.length ? `${sw ? 'Mwisho' : 'Last'}: ${logMonth(paid[0], periods, lang)}` : undefined,
      },
    );
    const recent = [...live].sort((a, b) => b.id - a.id).slice(0, 4);
    out.push({
      kpiLabel: sw ? 'Muhtasari wa majedwali yangu' : 'My timesheets at a glance',
      lead: correcting.length
        ? (sw ? `Majedwali ${num(correcting.length)} yanahitaji marekebisho yako.` : `${num(correcting.length)} ${correcting.length === 1 ? 'timesheet needs' : 'timesheets need'} your correction.`)
        : current.length
          ? (sw ? `Jedwali lako la ${monthName}: ${statusText(current[0].status, sw).toLowerCase()}.` : `Your ${monthName} timesheet: ${statusText(current[0].status, sw).toLowerCase()}.`)
          : (sw ? `Anza jedwali lako la ${monthName}.` : `Start your ${monthName} timesheet.`),
      kpis,
      list: recent.length ? {
        title: sw ? 'Majedwali yangu ya karibuni' : 'My recent timesheets',
        more: { label: sw ? 'Yote' : 'See all', page: 'my-logs' },
        items: recent.map((log, index) => (
          <button type="button" className="home-row" key={log.id ?? index} onClick={() => navigate('my-logs')}>
            <span className="home-row-main">
              <span className="cell-main">{logMonth(log, periods, lang)}</span>
              <span className="cell-sub">{daysText(log.entry_count, sw)} · {hoursText(log.total_hours, sw)}</span>
            </span>
            <span className="home-row-side"><WorkTypeChip type={log.work_type} /><StatusBadge kind="log" status={log.status} bare /></span>
          </button>
        )),
      } : undefined,
    });
  }

  const payroll = rows[QUEUE_PAYROLL] as WorkLogSummary[] | null;
  const services = rows[QUEUE_SERVICES] as WorkLogSummary[] | null;
  if (has(...REVIEW) && (payroll || services)) {
    const waiting = [...(payroll || []), ...(services || [])].sort((a, b) => b.hours_in_status - a.hours_in_status);
    const late = waiting.filter(row => row.hours_in_status >= 24);
    out.push({
      kpiLabel: sw ? 'Muhtasari wa mapitio' : 'Reviews at a glance',
      lead: waiting.length
        ? (sw ? `Majedwali ${num(waiting.length)} yanasubiri uamuzi wako.` : `${num(waiting.length)} ${waiting.length === 1 ? 'timesheet waits' : 'timesheets wait'} for your decision.`)
        : (sw ? 'Hakuna jedwali linalokusubiri.' : 'Nothing is waiting for you.'),
      kpis: [
        {
          label: sw ? 'Zinazonisubiri' : 'Waiting on me', value: num(waiting.length), icon: 'clipboard', onClick: () => navigate('worklogs'),
          note: `${workTypeName('PAYROLL', lang)} ${num(payroll?.length ?? 0)} · ${workTypeName('SERVICES', lang)} ${num(services?.length ?? 0)}`,
        },
        { label: sw ? 'Zaidi ya saa 24' : 'Over 24 h', value: num(late.length), tone: late.length ? 'warn' : 'success', icon: 'clock' },
        {
          label: sw ? 'Iliyosubiri muda mrefu' : 'Longest wait', value: waiting.length ? waitedText(waiting[0].hours_in_status, sw) : '—',
          note: waiting[0]?.staff_name, tone: late.length ? 'warn' : 'neutral', icon: 'alert',
        },
      ],
      list: waiting.length ? {
        title: sw ? 'Zilizosubiri muda mrefu' : 'Waiting longest',
        more: { label: sw ? 'Yote' : 'See all', page: 'worklogs' },
        items: waiting.slice(0, 5).map((row, index) => (
          <button type="button" className="home-row" key={row.id ?? index} onClick={() => navigate('worklogs', row.work_type)}>
            <span className="home-row-main"><PersonCell name={row.staff_name} sub={row.facility_name || row.region_name} /></span>
            <span className="home-row-side"><WorkTypeChip type={row.work_type} /><span className={`home-age${row.hours_in_status >= 24 ? ' is-late' : ''}`}>{waitedText(row.hours_in_status, sw)}</span></span>
          </button>
        )),
      } : undefined,
    });
  }

  const routing = rows[ROUTING] as RoutingQueueItem[] | null;
  if (has('REGIONAL_FINANCE') && routing) {
    const timesheets = routing.filter(item => item.next_action === 'REVIEW_TIMESHEET');
    const amounts = routing.filter(item => item.next_action !== 'REVIEW_TIMESHEET' && (item.finance_review_required || item.next_action === 'REVIEW_AMOUNT'));
    const total = sumAmount(routing);
    const step = (item: RoutingQueueItem) => item.next_action === 'REVIEW_TIMESHEET'
      ? (sw ? 'Hatua 1: jedwali' : 'Step 1: timesheet')
      : item.finance_review_required || item.next_action === 'REVIEW_AMOUNT' ? (sw ? 'Hatua 2: malipo' : 'Step 2: payment')
        : item.next_action === 'RESOLVE_BUDGET_HOLD' ? (sw ? 'Zuio la kihistoria' : 'Historical hold') : (sw ? 'Chagua njia' : 'Choose channel');
    out.push({
      kpiLabel: sw ? 'Muhtasari wa Huduma' : 'Services at a glance',
      lead: routing.length
        ? (sw ? `Huduma ${num(routing.length)} zinasubiri hatua yako.` : `${num(routing.length)} Services ${routing.length === 1 ? 'item waits' : 'items wait'} for you.`)
        : (sw ? 'Hakuna Huduma zinazokusubiri.' : 'No Services are waiting for you.'),
      kpis: [
        { label: sw ? 'Zinazonisubiri' : 'Waiting on me', value: num(routing.length), icon: 'route', onClick: () => navigate('routing-queue') },
        { label: sw ? 'Majedwali ya kukagua' : 'Timesheets to check', value: num(timesheets.length), tone: timesheets.length ? 'warn' : 'success', icon: 'clipboard' },
        { label: sw ? 'Malipo ya kukagua' : 'Payments to check', value: num(amounts.length), tone: amounts.length ? 'warn' : 'success', icon: 'wallet' },
        ...(total ? [{ label: sw ? 'Jumla ya kiasi' : 'Total amount', value: total, tone: 'info' as const, icon: 'receipt' as IconName }] : []),
      ],
      list: routing.length ? {
        title: sw ? 'Zinazonisubiri' : 'Waiting on me',
        more: { label: sw ? 'Zote' : 'See all', page: 'routing-queue' },
        items: routing.slice(0, 5).map((item, index) => (
          <button type="button" className="home-row" key={item.work_log_id ?? index} onClick={() => navigate('routing-queue')}>
            <span className="home-row-main"><PersonCell name={item.provider_name} sub={item.facility_name || item.region_name} /></span>
            <span className="home-row-side home-row-stack">
              <span className="cell-main">{item.amount === null || !item.currency ? '—' : money(item.amount, item.currency)}</span>
              <span className="cell-sub">{step(item)}</span>
            </span>
          </button>
        )),
      } : undefined,
    });
  }

  const claims = rows[CLAIMS] as ClaimSummary[] | null;
  if (has('FHI360_FINANCE') && claims) {
    const assigned = claims.filter(row => row.status === 'PENDING_CENTRAL_REVIEW' && row.central_reviewer_id === me.id);
    const ready = claims.filter(row => row.status === 'READY');
    const proof = claims.filter(row => row.payment_status === 'PROOF_REQUIRED');
    out.push({
      kpiLabel: sw ? 'Muhtasari wa Fedha Kuu' : 'Central Finance at a glance',
      lead: assigned.length
        ? (sw ? `Huduma ${num(assigned.length)} zimepewa wewe kuidhinisha.` : `${num(assigned.length)} Services ${assigned.length === 1 ? 'claim is' : 'claims are'} assigned to you.`)
        : (sw ? 'Hakuna Huduma zinazosubiri idhini yako.' : 'No Services wait for your approval.'),
      kpis: [
        { label: sw ? 'Zimepewa mimi' : 'Assigned to me', value: num(assigned.length), tone: assigned.length ? 'warn' : 'success', icon: 'receipt', onClick: () => navigate('claims') },
        { label: sw ? 'Tayari kwa malipo' : 'Ready for payment', value: num(ready.length), tone: 'info', icon: 'wallet' },
        { label: sw ? 'Inahitaji uthibitisho' : 'Proof required', value: num(proof.length), tone: proof.length ? 'warn' : 'success', icon: 'alert' },
      ],
      list: assigned.length ? {
        title: sw ? 'Zimepewa mimi' : 'Assigned to me',
        more: { label: sw ? 'Zote' : 'See all', page: 'claims' },
        items: assigned.slice(0, 5).map((row, index) => (
          <button type="button" className="home-row" key={row.id ?? index} onClick={() => navigate('claims')}>
            <span className="home-row-main"><PersonCell name={row.staff_name} sub={row.period_label} /></span>
            <span className="home-row-side"><span className="cell-main">{money(row.amount, row.currency)}</span></span>
          </button>
        )),
      } : undefined,
    });
  }
  if (has('CSO_FINANCE') && claims) {
    const pending = claims.filter(csoPending);
    const proof = claims.filter(row => row.payment_status === 'PROOF_REQUIRED');
    const paid = claims.filter(row => row.payment_status === 'PAID' || row.payment_status === 'RECONCILED');
    out.push({
      kpiLabel: sw ? 'Muhtasari wa malipo ya CSO' : 'CSO payments at a glance',
      lead: pending.length
        ? (sw ? `Malipo ${num(pending.length)} yanasubiri.` : `${num(pending.length)} ${pending.length === 1 ? 'payment is' : 'payments are'} pending.`)
        : (sw ? 'Hakuna malipo yanayosubiri.' : 'No payments are pending.'),
      kpis: [
        { label: sw ? 'Malipo yanayosubiri' : 'Pending payments', value: num(pending.length), tone: pending.length ? 'warn' : 'success', icon: 'receipt', onClick: () => navigate('cso') },
        { label: sw ? 'Inahitaji uthibitisho' : 'Proof required', value: num(proof.length), tone: proof.length ? 'warn' : 'success', icon: 'alert' },
        { label: sw ? 'Zimelipwa' : 'Paid', value: num(paid.length), tone: 'success', icon: 'wallet' },
      ],
    });
  }

  const community = rows[COMMUNITY] as ClaimSummary[] | null;
  if (has('COMMUNITY_VERIFIER') && community) {
    const waiting = community.filter(row => row.status === 'PENDING_COMMUNITY_VERIFICATION');
    out.push({
      kpiLabel: sw ? 'Muhtasari wa madai ya jamii' : 'Community claims at a glance',
      lead: waiting.length
        ? (sw ? `Madai ${num(waiting.length)} yanasubiri uhakiki wako.` : `${num(waiting.length)} ${waiting.length === 1 ? 'claim waits' : 'claims wait'} for your verification.`)
        : (sw ? 'Hakuna madai yanayosubiri uhakiki.' : 'No claims wait for verification.'),
      kpis: [
        { label: sw ? 'Yanasubiri uhakiki' : 'Awaiting verification', value: num(waiting.length), tone: waiting.length ? 'warn' : 'success', icon: 'users', onClick: () => navigate('community-claims') },
        { label: sw ? 'Madai yote' : 'All claims', value: num(community.length), icon: 'receipt' },
      ],
    });
  }
  return out;
}

/** The first page every login sees: what is waiting for this person, one click from doing it. */
export function Home() {
  const { me, lang, hasRole } = useAuth();
  const language: Lang = lang === 'en' ? 'en' : 'sw';
  const sw = language === 'sw';
  // A Super Admin technically holds every role, so show their own work, not everyone else's.
  const superAdmin = !!me?.roles.includes('SUPER_ADMIN');
  const has = (...roles: string[]) => !!me && !superAdmin && hasRole(...roles);
  const tasks = me ? TASKS.filter(task => (superAdmin ? ['staff-changes', 'users', 'overview'].includes(task.key) : hasRole(...task.roles))) : [];
  const needed = new Set<string>(tasks.flatMap(task => (task.count ? [task.count.path] : [])));
  if (has('PROVIDER')) needed.add(MINE).add(PERIODS);
  if (has('CSO_FINANCE')) needed.add(CLAIMS);
  // One request per list, shared by the task cards and the numbers above them.
  const path = (p: string) => (needed.has(p) ? p : null);
  const rows: Rows = {
    [MINE]: useApi<any[]>(path(MINE)).data,
    [PERIODS]: useApi<any[]>(path(PERIODS)).data,
    [QUEUE_PAYROLL]: useApi<any[]>(path(QUEUE_PAYROLL)).data,
    [QUEUE_SERVICES]: useApi<any[]>(path(QUEUE_SERVICES)).data,
    [ROUTING]: useApi<any[]>(path(ROUTING)).data,
    [CLAIMS]: useApi<any[]>(path(CLAIMS)).data,
    [COMMUNITY]: useApi<any[]>(path(COMMUNITY)).data,
    [CHANGES]: useApi<any[]>(path(CHANGES)).data,
  };
  if (!me) return null;
  const setup = SETUP.filter(step => hasRole(...step.roles));
  const today = todayLocal();
  const progress = monthProgress(today);
  const monthName = new Intl.DateTimeFormat(sw ? 'sw-TZ' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${progress.last}T00:00:00Z`));
  const firstName = me.staff ? me.full_name.split(/\s+/).find(part => part !== 'DEMO') || me.full_name : me.full_name.replace(/^DEMO\s+/, '');
  const blocks = summaries(rows, me, has, language, monthName);
  const lead = blocks.find(block => block.lead)?.lead;
  const primary = tasks[0];
  const lists = blocks.filter(block => block.list);
  return (
    <div className="stack-lg home">
      <section className="home-hero" aria-label={sw ? 'Muhtasari wa leo' : "Today's summary"}>
        <div className="home-hero-text">
          <p className="home-date">{dateOnly(today)}</p>
          <h1>{greeting(language)}, {firstName}</h1>
          {lead && <p className="home-lead">{lead}</p>}
          {primary && (
            <button type="button" className="btn home-cta" onClick={() => navigate(primary.page, primary.target)}>
              {primary.title[language]}
              <Icon name="chevron" size={16} />
            </button>
          )}
        </div>
        <div className="home-month">
          <div className="home-month-head">
            <span>{sw ? 'Mwezi wa kazi' : 'Work month'}</span>
            <strong>{monthName}</strong>
          </div>
          <div className="home-month-bar" role="progressbar" aria-label={sw ? 'Maendeleo ya mwezi wa kazi' : 'Work month progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <p>
            {progress.left === 0
              ? (sw ? 'Leo ni siku ya kuwasilisha' : 'Today is submission day')
              : sw ? `Siku ${num(progress.left)} hadi ${dateOnly(progress.last)}` : `${num(progress.left)} ${progress.left === 1 ? 'day' : 'days'} until ${dateOnly(progress.last)}`}
          </p>
        </div>
      </section>
      {blocks.map(block => block.kpis.length > 0 && <KpiStrip key={block.kpiLabel} items={block.kpis} label={block.kpiLabel} />)}
      {setup.length > 0 && <SetupChecklist lang={language} steps={setup} />}
      <div className={`home-body${lists.length ? ' has-side' : ''}`}>
        <section aria-labelledby="home-tasks">
          <div className="section-title"><h2 id="home-tasks">{sw ? 'Kazi zako' : 'Your work'}</h2></div>
          {tasks.length
            ? <div className="task-grid">{tasks.map(task => <TaskCard key={task.key} task={task} lang={language} me={me} rows={rows} />)}</div>
            : <p className="muted">{sw ? 'Tumia menyu kufungua kurasa zako.' : 'Use the menu to open your pages.'}</p>}
        </section>
        {lists.map(block => block.list && (
          <section className="card home-list" key={block.list.title} aria-label={block.list.title}>
            <div className="section-title">
              <h2>{block.list.title}</h2>
              {block.list.more && <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(block.list!.more!.page)}>{block.list.more.label}</button>}
            </div>
            <div className="home-rows">{block.list.items}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
