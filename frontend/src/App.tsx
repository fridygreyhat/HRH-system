import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { BrandMark, Icon } from './components/Icon';
import { roleLabel } from './format';
import { useApi } from './hooks';
import { navigate, useHashRoute } from './nav';
import { ChangePasswordForm, ForcedPasswordChange } from './pages/ChangePassword';
import { Login } from './pages/Login';
import { Modal } from './components/ui';
import { Home } from './pages/Home';
import { useTheme } from './theme';
import { WorkLogSummary } from './types';
import { useStackedTables } from './stackTables';
import { lazyPage, PageBoundary } from './lazyPage';

// Screens download when first opened: signing in needs only the shell, the sign-in and the home page.
const Admin = lazyPage(() => import('./pages/Admin').then((m) => m.Admin));
const Batches = lazyPage(() => import('./pages/Batches').then((m) => m.Batches));
const BackdateAccess = lazyPage(() => import('./pages/BackdateAccess').then((m) => m.BackdateAccess));
const Claims = lazyPage(() => import('./pages/Claims').then((m) => m.Claims));
const CommunityClaims = lazyPage(() => import('./pages/CommunityClaims').then((m) => m.CommunityClaims));
const CsoPortal = lazyPage(() => import('./pages/CsoPortal').then((m) => m.CsoPortal));
const Dashboard = lazyPage(() => import('./pages/Dashboard').then((m) => m.Dashboard));
const FinanceMonthlyReport = lazyPage(() => import('./pages/FinanceMonthlyReport').then((m) => m.FinanceMonthlyReport));
const MonthlyServicesBudgets = lazyPage(() => import('./pages/MonthlyServicesBudgets').then((m) => m.MonthlyServicesBudgets));
const MyWorkLogs = lazyPage(() => import('./pages/MyWorkLogs').then((m) => m.MyWorkLogs));
const Organizations = lazyPage(() => import('./pages/Organizations').then((m) => m.Organizations));
const PrintWorkLog = lazyPage(() => import('./pages/PrintWorkLog').then((m) => m.PrintWorkLog));
const PrintBatch = lazyPage(() => import('./pages/PrintBatch').then((m) => m.PrintBatch));
const ProviderPaymentDetails = lazyPage(() => import('./pages/ProviderPaymentDetails').then((m) => m.ProviderPaymentDetails));
const PayPeriods = lazyPage(() => import('./pages/PayPeriods').then((m) => m.PayPeriods));
const SalaryAmounts = lazyPage(() => import('./pages/SalaryAmounts').then((m) => m.SalaryAmounts));
const PublicHolidays = lazyPage(() => import('./pages/PublicHolidays').then((m) => m.PublicHolidays));
const ReviewWorkLogs = lazyPage(() => import('./pages/ReviewWorkLogs').then((m) => m.ReviewWorkLogs));
const RoutingQueue = lazyPage(() => import('./pages/RoutingQueue').then((m) => m.RoutingQueue));
const PayrollToCso = lazyPage(() => import('./pages/PayrollToCso').then((m) => m.PayrollToCso));
const FinanceDownloads = lazyPage(() => import('./pages/FinanceDownloads').then((m) => m.FinanceDownloads));
const BulkApproval = lazyPage(() => import('./pages/BulkApproval').then((m) => m.BulkApproval));
const Rates = lazyPage(() => import('./pages/Rates').then((m) => m.Rates));
const ReviewCadres = lazyPage(() => import('./pages/ReviewCadres').then((m) => m.ReviewCadres));
const Staff = lazyPage(() => import('./pages/Staff').then((m) => m.Staff));

const REVIEWERS = ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE'];

interface Page {
  key: string;
  label: string;
  description: string;
  icon: string;
  group: string;
  roles: string[];
  render: (target?: string) => React.ReactNode;
}

const EVERY_ROLE = ['PROVIDER', 'SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'COMMUNITY_VERIFIER',
  'FHI360_FINANCE', 'CSO_FINANCE', 'OVERSIGHT', 'CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN'];

/** Menu wording in Kiswahili, the default language. */
const LABELS_SW: Record<string, string> = {
  home: 'Mwanzo', dashboard: 'Dashibodi', 'my-logs': 'Kumbukumbu zangu', 'payment-details': 'Taarifa za malipo', 'backdate-access': 'Ruhusa ya tarehe zilizopita',
  rates: 'Viwango vya huduma', 'pay-periods': 'Vipindi vya malipo', 'public-holidays': 'Sikukuu', 'routing-queue': 'Huduma za kukagua', 'payroll-to-cso': 'Mshahara kwa CSO', 'finance-downloads': 'Upakuaji wa Fedha', 'bulk-approval': 'Idhinisha majedwali', 'finance-monthly': 'Ripoti ya mwezi',
  'review-cadres': 'Mgawo wa wakaguzi', worklogs: 'Mapitio ya majedwali', claims: 'Madai ya malipo', batches: 'Makundi ya malipo', budgets: 'Bajeti ya huduma',
  'salary-amounts': 'Viwango vya mishahara', cso: 'Malipo ya CSO', 'community-claims': 'Madai ya jamii', staff: 'Daftari la watumishi', organizations: 'Mashirika na mikoa', admin: 'Utawala',
};
const DESCRIPTIONS_SW: Record<string, string> = {
  'my-logs': 'Rekodi na uwasilishe kazi zako za kila siku', 'payment-details': 'Akaunti yako ya benki na simu ya malipo',
  'backdate-access': 'Ruhusa ya muda kwa tarehe zilizopita', rates: 'Huduma, viwango vya kila siku na siku za chini',
  'pay-periods': 'Ratiba za kazi na malipo za mikoa', 'public-holidays': 'Sikukuu zinazoonekana kwenye kalenda na majedwali',
  'routing-queue': 'Idhinisha na upeleke Huduma', 'payroll-to-cso': 'Saini Mshahara na uutume kwa CSO', 'finance-downloads': 'Majedwali, shughuli, malipo na faili la kuingiza', 'bulk-approval': 'Idhinisha majedwali safi kwa pamoja', 'finance-monthly': 'Jumla ya kazi zilizoidhinishwa kwa mwezi',
  'review-cadres': 'Kada na maeneo ya wakaguzi', worklogs: 'Amua majedwali ya eneo lako', claims: 'Andaa, idhinisha na ufuatilie madai',
  batches: 'Faili za malipo, makabidhiano na stakabadhi', budgets: 'Bajeti za Huduma za mikoa kwa mwezi', 'salary-amounts': 'Mshahara wa mwezi kwa kila ngazi',
  cso: 'Malipo, uthibitisho na majedwali ya mishahara', 'community-claims': 'Madai ya jamii na malipo yake', staff: 'Watumishi, vituo vyao na mizunguko',
  organizations: 'Mashirika na mikoa yao', admin: 'Watumiaji, mipangilio na ukaguzi',
};
const GROUPS_SW: Record<string, string> = { Overview: 'Muhtasari', Work: 'Kazi', Finance: 'Fedha', Registry: 'Daftari', System: 'Mfumo' };
/** The bottom bar on phones: the pages a role opens most, in order. */
const PHONE_LABELS: Record<string, { en: string; sw: string }> = {
  home: { en: 'Home', sw: 'Mwanzo' }, 'my-logs': { en: 'My logs', sw: 'Kazi' }, worklogs: { en: 'Reviews', sw: 'Mapitio' }, 'routing-queue': { en: 'Services', sw: 'Huduma' },
  cso: { en: 'Payments', sw: 'Malipo' }, claims: { en: 'Claims', sw: 'Madai' }, staff: { en: 'Staff', sw: 'Watumishi' }, 'community-claims': { en: 'Community', sw: 'Jamii' }, dashboard: { en: 'Overview', sw: 'Muhtasari' },
};
const PHONE_PAGES = ['my-logs', 'worklogs', 'routing-queue', 'cso', 'claims', 'staff', 'community-claims', 'dashboard'];

export const PAGES: Page[] = [
  { key: 'home', label: 'Home', description: 'Your work today', icon: 'home', group: 'Overview', roles: EVERY_ROLE, render: () => <Home /> },
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Approvals, claims and payment progress',
    icon: 'dashboard',
    group: 'Overview',
    roles: ['OVERSIGHT', 'RPM', 'REGIONAL_FINANCE', 'TECHNICAL_OFFICER', 'CSO_TECHNICAL_OFFICER', 'SUPERVISOR', 'FHI360_FINANCE', 'CSO_FINANCE', 'CENTRAL_ADMIN', 'REGIONAL_ADMIN'],
    render: () => <Dashboard />,
  },
  { key: 'my-logs', label: 'My work logs', description: 'Record and submit your daily work', icon: 'calendar', group: 'Work', roles: ['PROVIDER'], render: () => <MyWorkLogs /> },
  { key: 'payment-details', label: 'Payment details', description: 'Your bank account and mobile wallet', icon: 'wallet', group: 'Work', roles: ['PROVIDER'], render: () => <ProviderPaymentDetails /> },
  { key: 'backdate-access', label: 'Backdated entry access', description: 'Temporary access to past dates', icon: 'calendar', group: 'Work', roles: ['TECHNICAL_OFFICER', 'SUPER_ADMIN'], render: () => <BackdateAccess /> },
  { key: 'rates', label: 'Service amounts', description: 'Services, daily amounts and minimum days', icon: 'receipt', group: 'Finance', roles: ['TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'OVERSIGHT', 'SUPER_ADMIN'], render: () => <Rates /> },
  { key: 'pay-periods', label: 'Pay periods', description: 'Regional work and pay schedules', icon: 'calendar', group: 'Finance', roles: ['TECHNICAL_OFFICER', 'CENTRAL_ADMIN', 'FHI360_FINANCE', 'SUPER_ADMIN'], render: () => <PayPeriods /> },
  { key: 'public-holidays', label: 'Public holidays', description: 'Holidays shown on calendars and timesheets', icon: 'calendar', group: 'System', roles: ['CENTRAL_ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN'], render: () => <PublicHolidays /> },
  { key: 'bulk-approval', label: 'Approve timesheets', description: 'Approve clean timesheets together', icon: 'check', group: 'Finance', roles: ['REGIONAL_FINANCE', 'SUPER_ADMIN'], render: (target) => <BulkApproval initial={target} /> },
  { key: 'routing-queue', label: 'Services to review', description: 'Approve and route Services', icon: 'route', group: 'Finance', roles: ['REGIONAL_FINANCE', 'SUPER_ADMIN'], render: () => <RoutingQueue /> },
  { key: 'payroll-to-cso', label: 'Payroll to CSO', description: 'Sign Payroll and send it to the CSO', icon: 'wallet', group: 'Finance', roles: ['REGIONAL_FINANCE', 'SUPER_ADMIN'], render: () => <PayrollToCso /> },
  { key: 'finance-downloads', label: 'Finance downloads', description: 'Timesheets, activities, payment summary, import file', icon: 'table', group: 'Finance', roles: ['REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'SUPER_ADMIN'], render: () => <FinanceDownloads /> },
  { key: 'finance-monthly', label: 'Monthly work report', description: 'Approved work totals by pay month', icon: 'calendar', group: 'Finance', roles: ['REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'SUPER_ADMIN'], render: (target) => <FinanceMonthlyReport initial={target} /> },
  { key: 'review-cadres', label: 'Review assignments', description: 'Reviewer cadres and areas', icon: 'users', group: 'System', roles: ['SYSTEM_ADMIN', 'SUPER_ADMIN'], render: () => <ReviewCadres /> },
  {
    key: 'worklogs',
    label: 'Timesheet reviews',
    description: 'Decide timesheets in your scope',
    icon: 'clipboard',
    group: 'Work',
    roles: [...REVIEWERS, 'OVERSIGHT', 'FHI360_FINANCE'],
    render: (target) => <ReviewWorkLogs initialType={target === 'PAYROLL' || target === 'SERVICES' ? target : undefined} />,
  },
  {
    key: 'claims',
    label: 'Payment claims',
    description: 'Prepare, approve and track claims',
    icon: 'receipt',
    group: 'Finance',
    roles: ['FHI360_FINANCE', 'CSO_FINANCE', 'REGIONAL_FINANCE', 'RPM', 'OVERSIGHT', 'COMMUNITY_VERIFIER', 'PROVIDER'],
    render: () => <Claims />,
  },
  { key: 'batches', label: 'Payment batches', description: 'Payment exports, handoffs and receipts', icon: 'layers', group: 'Finance', roles: ['FHI360_FINANCE', 'CSO_FINANCE', 'OVERSIGHT'], render: () => <Batches /> },
  { key: 'budgets', label: 'Service budgets', description: 'Monthly regional Services budgets', icon: 'wallet', group: 'Finance', roles: ['REGIONAL_FINANCE', 'FHI360_FINANCE', 'SUPER_ADMIN'], render: () => <MonthlyServicesBudgets /> },
  { key: 'salary-amounts', label: 'Salary amounts', description: 'Monthly salary for each scale', icon: 'wallet', group: 'Finance', roles: ['FHI360_FINANCE', 'SUPER_ADMIN'], render: () => <SalaryAmounts /> },
  { key: 'cso', label: 'CSO payments', description: 'Payments, proof and salary timesheets', icon: 'wallet', group: 'Finance', roles: ['CSO_FINANCE'], render: (target) => <CsoPortal initialSection={target === 'salary' ? 'export' : undefined} /> },
  { key: 'community-claims', label: 'Community claims', description: 'Community claims and direct payment', icon: 'users', group: 'Finance', roles: ['PROVIDER', 'COMMUNITY_VERIFIER', 'TECHNICAL_OFFICER', 'CSO_FINANCE', 'OVERSIGHT', 'SUPER_ADMIN'], render: () => <CommunityClaims /> },
  {
    key: 'staff',
    label: 'Staff registry',
    description: 'Staff, placements and rotations',
    icon: 'users',
    group: 'Registry',
    roles: ['CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'CSO_FINANCE', 'SYSTEM_ADMIN', 'FHI360_FINANCE', 'OVERSIGHT'],
    render: () => <Staff />,
  },
  {
    key: 'organizations',
    label: 'Organizations / CSO regions',
    description: 'Organizations and their regions',
    icon: 'route',
    group: 'Registry',
    roles: ['CENTRAL_ADMIN', 'FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT', 'REGIONAL_FINANCE', 'SUPER_ADMIN'],
    render: () => <Organizations />,
  },
  {
    key: 'admin',
    label: 'Administration',
    description: 'Users, configuration, rates, SMS and audit',
    icon: 'settings',
    group: 'System',
    roles: ['SYSTEM_ADMIN', 'CENTRAL_ADMIN', 'FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT'],
    render: () => <Admin />,
  },
];
const GROUPS = ['Overview', 'Work', 'Finance', 'Registry', 'System'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

function LanguageToggle() {
  const { lang, setLanguage } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const choose = (l: 'en' | 'sw') => setLanguage(l).catch((e: Error) => setError(e.message));
  return (
    <div className="pill-toggle" role="group" aria-label="Language / Lugha" title={error || 'Language / Lugha'}>
      <Icon name="globe" size={16} />
      <button type="button" aria-pressed={lang === 'sw'} onClick={() => choose('sw')}>
        SW
      </button>
      <button type="button" aria-pressed={lang === 'en'} onClick={() => choose('en')}>
        EN
      </button>
    </div>
  );
}

function ThemeToggle() {
  const { toggle } = useTheme();
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label="Switch light or dark theme" title="Switch light / dark theme">
      <Icon name="sun" className="only-dark" />
      <Icon name="moon" className="only-light" />
    </button>
  );
}

function QueueCount() {
  const { data } = useApi<WorkLogSummary[]>('/worklogs?queue=true');
  if (!data?.length) return null;
  return (
    <span className="nav-count" aria-label={`${data.length} waiting for you`}>
      {data.length}
    </span>
  );
}

function App() {
  useStackedTables();
  const { me, loading, logout, hasRole, lang } = useAuth();
  const route = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const pages = PAGES.filter((p) => hasRole(...p.roles));
  const defaultPage = pages[0];
  const current = pages.find((p) => p.key === route.page) || defaultPage;
  const isReviewer = hasRole(...REVIEWERS);
  // A super admin holds every role; naming them all would crowd the top bar.
  const roleSummary = me ? (me.roles.includes('SUPER_ADMIN') ? roleLabel('SUPER_ADMIN') : me.roles.map(roleLabel).join(', ')) : '';
  // Health workers also see their cadre, e.g. "Provider · Health Care Provider".
  const identity = me?.cadre ? `${roleSummary} · ${me.cadre.name}` : roleSummary;

  // Facility In-Charge reads rather than reviews, so the page is named for what they do there.
  const readsFacility = hasRole('FACILITY_IN_CHARGE') && !hasRole('SUPERVISOR', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE');
  const label = (page: Page) => {
    if (page.key === 'worklogs' && readsFacility) return lang === 'sw' ? 'Majedwali ya kituo changu' : "My facility's timesheets";
    return lang === 'sw' ? LABELS_SW[page.key] || page.label : page.label;
  };
  const banded = current && current.key !== 'home' && current.key !== 'dashboard';
  const phonePages = [pages[0], ...PHONE_PAGES.map((key) => pages.find((page) => page.key === key)).filter((page): page is Page => Boolean(page))].filter(Boolean).slice(0, 4);
  const term = menuSearch.trim().toLocaleLowerCase();

  useEffect(() => setMenuOpen(false), [route.page]);
  // A new page starts at the top, and keyboard and screen-reader users start there too.
  useEffect(() => {
    window.scrollTo?.(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [route.page, route.id]);
  document.documentElement.lang = lang === 'en' ? 'en' : 'sw'; // during render: shared components read it for their own text
  useEffect(() => {
    document.body.classList.toggle('no-scroll', menuOpen);
  }, [menuOpen]);

  if (loading)
    return (
      <div className="boot">
        <BrandMark size={48} />
        <span className="muted">Loading…</span>
      </div>
    );
  if (!me) return <Login />;
  if (me.must_change_password) return <ForcedPasswordChange />;

  const printing = route.page === 'print' && route.id;
  if (printing)
    return (
      <main className="content content-print">
        <PageBoundary resetKey={`print-${route.id}`}>
          <PrintWorkLog logId={Number(route.id)} />
        </PageBoundary>
      </main>
    );
  if (route.page === 'print-batch')
    return (
      <main className="content content-print">
        <PageBoundary resetKey={`print-batch-${route.id}`}>
          <PrintBatch target={route.id} />
        </PageBoundary>
      </main>
    );

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <BrandMark />
          <div>
            <div className="brand-name">
              HRH Pay
              <img src={`${process.env.PUBLIC_URL}/brand/tanzania-nembo.png`} alt="Nembo ya Taifa" title="Nembo ya Taifa" className="brand-nembo" />
            </div>
            <div className="brand-sub">{lang === 'sw' ? 'Kazi · Madai · Malipo' : 'Work logs · Claims · Payroll'}</div>
          </div>
          <button type="button" className="icon-btn sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <nav className="sidebar-nav">
          {pages.length > 9 && (
            <label className="nav-search">
              <span className="sr-only">{lang === 'sw' ? 'Tafuta menyu' : 'Search the menu'}</span>
              <input type="search" value={menuSearch} placeholder={lang === 'sw' ? 'Tafuta…' : 'Find a page…'} onChange={(event) => setMenuSearch(event.target.value)} />
            </label>
          )}
          {GROUPS.map((group) => {
            const items = pages.filter((p) => p.group === group && (!term || label(p).toLocaleLowerCase().includes(term) || p.label.toLocaleLowerCase().includes(term)));
            if (!items.length) return null;
            return (
              <div key={group} className="nav-group">
                <div className="nav-group-label">{lang === 'sw' ? GROUPS_SW[group] : group}</div>
                {items.map((p) => {
                  const active = p.key === current?.key;
                  return (
                    <button key={p.key} type="button" className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => { setMenuOpen(false); navigate(p.key); }}>
                      <Icon name={p.icon} />
                      <span>{label(p)}</span>
                      {p.key === 'worklogs' && isReviewer && <QueueCount />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
      <button type="button" className="sidebar-scrim" aria-label="Close menu" tabIndex={-1} onClick={() => setMenuOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn nav-toggle" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            <Icon name="menu" />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            {current && (
              <>
                <span className="crumb-group">{lang === 'sw' ? GROUPS_SW[current.group] : current.group}</span>
                <Icon name="chevron" size={14} />
                <span className="crumb-page" aria-current="page">
                  {label(current)}
                </span>
              </>
            )}
          </nav>
          <div className="topbar-actions">
            <LanguageToggle />
            <ThemeToggle />
            <div className="user-chip" title={identity}>
              <span className="avatar" aria-hidden="true">
                {initials(me.full_name)}
              </span>
              <span className="user-text">
                <span className="user-name">{me.full_name}</span>
                <span className="user-role">{identity}</span>
              </span>
            </div>
            <button type="button" className="icon-btn" onClick={() => setPasswordOpen(true)} aria-label="Change password" title="Change password">
              <Icon name="shield" />
            </button>
            <button type="button" className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="content" ref={mainRef} tabIndex={-1}>
          {current ? (
            <React.Fragment key={`${current.key}-${route.id || ''}`}>
              {banded && (
                <header className="page-band">
                  <span className="band-icon"><Icon name={current.icon} /></span>
                  <div>
                    <h1>{label(current)}</h1>
                    <p>{lang === 'sw' ? DESCRIPTIONS_SW[current.key] || current.description : current.description}</p>
                  </div>
                </header>
              )}
              <div className={banded ? 'banded' : undefined}>
                <PageBoundary resetKey={`${current.key}-${route.id || ''}`}>{current.render(route.id || undefined)}</PageBoundary>
              </div>
            </React.Fragment>
          ) : (
            <p className="empty">Your account has no roles with pages yet. Ask an administrator.</p>
          )}
        </main>
      </div>
      <nav className="bottom-nav" aria-label={lang === 'sw' ? 'Kurasa kuu' : 'Main pages'}>
        {phonePages.map((page) => (
          <button key={page.key} type="button" className={page.key === current?.key ? 'active' : ''} aria-current={page.key === current?.key ? 'page' : undefined} onClick={() => navigate(page.key)}>
            <Icon name={page.icon} />
            <span>{PHONE_LABELS[page.key]?.[lang === 'sw' ? 'sw' : 'en'] || label(page)}</span>
          </button>
        ))}
        <button type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <Icon name="menu" />
          <span>{lang === 'sw' ? 'Menyu' : 'Menu'}</span>
        </button>
      </nav>
      {passwordOpen && (
        <Modal title="Change password" onClose={() => setPasswordOpen(false)}>
          <ChangePasswordForm onDone={() => setPasswordOpen(false)} />
        </Modal>
      )}
    </div>
  );
}

export default App;
