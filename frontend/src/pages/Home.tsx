import React from 'react';
import { useAuth } from '../AuthContext';
import { Icon } from '../components/Icon';
import { dateOnly, num, payMonth, payMonthRange, TIMEZONE, todayLocal } from '../format';
import { useApi } from '../hooks';
import { navigate } from '../nav';
import { Me } from '../types';

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
    count: { path: '/worklogs?mine=true', pick: rows => rows.filter(row => NEEDS_CORRECTION.includes(row.status)).length },
  },
  {
    key: 'review-payroll', page: 'worklogs', target: 'PAYROLL', icon: 'clipboard', roles: REVIEW,
    title: { en: 'Payroll timesheets', sw: 'Majedwali ya Payroll' },
    hint: { en: 'Waiting for your decision', sw: 'Yanasubiri uamuzi wako' },
    count: { path: '/worklogs?queue=true&work_type=PAYROLL' },
  },
  {
    key: 'review-services', page: 'worklogs', target: 'SERVICES', icon: 'clipboard', roles: REVIEW,
    title: { en: 'Services timesheets', sw: 'Majedwali ya Huduma' },
    hint: { en: 'Waiting for your decision', sw: 'Yanasubiri uamuzi wako' },
    count: { path: '/worklogs?queue=true&work_type=SERVICES' },
  },
  {
    key: 'facility-timesheets', page: 'worklogs', icon: 'clipboard', roles: ['FACILITY_IN_CHARGE'],
    title: { en: "My facility's timesheets", sw: 'Majedwali ya kituo changu' },
    hint: { en: 'Read every cadre at your facility', sw: 'Soma kila kada katika kituo chako' },
  },
  {
    key: 'finance-services', page: 'routing-queue', icon: 'route', roles: ['REGIONAL_FINANCE'],
    title: { en: 'Services to review', sw: 'Huduma za kukagua' },
    hint: { en: 'Approve timesheets and payments, then send to Central Finance', sw: 'Idhinisha majedwali na malipo, kisha tuma Fedha Kuu' },
    count: { path: '/finance/pending-routing?work_type=SERVICES' },
  },
  {
    key: 'finance-report', page: 'finance-monthly', icon: 'pie', roles: ['REGIONAL_FINANCE'],
    title: { en: 'Monthly report to sign', sw: 'Ripoti ya mwezi ya kusaini' },
    hint: { en: 'Sign the Payroll report so the CSO can pay salaries', sw: 'Saini ripoti ya Payroll ili CSO walipe mishahara' },
  },
  {
    key: 'central-claims', page: 'claims', icon: 'receipt', roles: ['FHI360_FINANCE'],
    title: { en: 'Services for your approval', sw: 'Huduma za idhini yako' },
    hint: { en: 'Assigned to you by Regional Finance', sw: 'Umepewa na Fedha ya Mkoa' },
    count: { path: '/claims', pick: (rows, me) => rows.filter(row => row.status === 'PENDING_CENTRAL_REVIEW' && row.central_reviewer_id === me.id).length },
  },
  {
    key: 'salary-files', page: 'cso', target: 'salary', icon: 'wallet', roles: ['CSO_FINANCE'],
    title: { en: 'Salary timesheets', sw: 'Majedwali ya mishahara' },
    hint: { en: 'Download signed salaries for facility and community', sw: 'Pakua mishahara iliyosainiwa ya kituo na jamii' },
  },
  {
    key: 'cso-payments', page: 'cso', icon: 'receipt', roles: ['CSO_FINANCE'],
    title: { en: 'CSO payments', sw: 'Malipo ya CSO' },
    hint: { en: 'Record payments and upload proof', sw: 'Rekodi malipo na pakia uthibitisho' },
  },
  {
    key: 'community-verify', page: 'community-claims', icon: 'users', roles: ['COMMUNITY_VERIFIER'],
    title: { en: 'Community claims', sw: 'Madai ya jamii' },
    hint: { en: 'Confirm that the service was delivered', sw: 'Thibitisha kuwa huduma ilitolewa' },
  },
  {
    key: 'staff-changes', page: 'staff', icon: 'shield', roles: ['CENTRAL_ADMIN', 'SYSTEM_ADMIN'],
    title: { en: 'Staff changes to decide', sw: 'Mabadiliko ya watumishi ya kuamua' },
    hint: { en: 'Payment details waiting for a second admin', sw: 'Taarifa za malipo zinasubiri msimamizi wa pili' },
    count: { path: '/staff/change-requests' },
  },
  {
    key: 'staff-registry', page: 'staff', icon: 'users', roles: STAFF_ADMINS,
    title: { en: 'Staff registry', sw: 'Daftari la watumishi' },
    hint: { en: 'Add staff, placements and rotations', sw: 'Ongeza watumishi na vituo vyao' },
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
  hint: Record<Lang, string>;
}

/** The order a new system has to be set up in. Each step checks the real data, so it ticks itself. */
const SETUP: SetupStep[] = [
  {
    key: 'cso', page: 'organizations', roles: ['CENTRAL_ADMIN', 'SUPER_ADMIN'], path: '/organizations', done: data => (data.organizations || []).some((org: any) => org.type === 'CSO'),
    title: { en: 'Add your CSOs and link their regions', sw: 'Ongeza CSO na uunganishe mikoa yao' },
    hint: { en: 'Salaries reach providers through their CSO', sw: 'Mishahara hufika kwa watoa huduma kupitia CSO' },
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
    hint: { en: 'CSOs see these in their salary files', sw: 'CSO wanaona hivi kwenye faili za mishahara' },
  },
  {
    key: 'staff', page: 'staff', roles: ['CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'SUPER_ADMIN'], path: '/staff', done: data => data.length > 0,
    title: { en: 'Register your providers', sw: 'Sajili watoa huduma wako' },
    hint: { en: 'Three short steps each, or import a roster', sw: 'Hatua tatu fupi kwa kila mmoja, au pakia orodha' },
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
          <span className="task-hint">{step.hint[lang]}</span>
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
        <div>
          <h2 id="setup-title">{lang === 'sw' ? 'Andaa mfumo wako' : 'Set up your system'}</h2>
          <p className="muted small">{lang === 'sw' ? 'Fuata hatua hizi kwa mpangilio. Zinajitia alama zikikamilika.' : 'Follow these in order. Each one ticks itself when done.'}</p>
        </div>
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

function TaskCard({ task, lang, me }: { task: Task; lang: Lang; me: Me }) {
  const { data } = useApi<any[]>(task.count?.path ?? null);
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

/** The first page every login sees: what is waiting for this person, one click from doing it. */
export function Home() {
  const { me, lang, hasRole } = useAuth();
  if (!me) return null;
  const language: Lang = lang === 'en' ? 'en' : 'sw';
  const sw = language === 'sw';
  // A Super Admin technically holds every role, so show their own work, not everyone else's.
  const superAdmin = me.roles.includes('SUPER_ADMIN');
  const tasks = TASKS.filter(task => (superAdmin ? ['staff-changes', 'users', 'overview'].includes(task.key) : hasRole(...task.roles)));
  const setup = SETUP.filter(step => hasRole(...step.roles));
  const today = todayLocal();
  const progress = monthProgress(today);
  const monthName = new Intl.DateTimeFormat(sw ? 'sw-TZ' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${progress.last}T00:00:00Z`));
  const firstName = me.staff ? me.full_name.split(/\s+/).find(part => part !== 'DEMO') || me.full_name : me.full_name.replace(/^DEMO\s+/, '');
  return (
    <div className="stack-lg home">
      <section className="home-hero" aria-label={sw ? 'Muhtasari wa leo' : "Today's summary"}>
        <div className="home-hero-text">
          <p className="home-date">{dateOnly(today)}</p>
          <h1>{greeting(language)}, {firstName}</h1>
          <p className="home-lead">{sw ? 'Hivi ndivyo kazi yako inavyoonekana leo.' : "Here's what needs you today."}</p>
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
      {setup.length > 0 && <SetupChecklist lang={language} steps={setup} />}
      <section aria-labelledby="home-tasks">
        <h2 id="home-tasks" className="home-heading">{sw ? 'Kazi zako' : 'Your work'}</h2>
        {tasks.length
          ? <div className="task-grid">{tasks.map(task => <TaskCard key={task.key} task={task} lang={language} me={me} />)}</div>
          : <p className="muted">{sw ? 'Tumia menyu kufungua kurasa zako.' : 'Use the menu to open your pages.'}</p>}
      </section>
    </div>
  );
}
