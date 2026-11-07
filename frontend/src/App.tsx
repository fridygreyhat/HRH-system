import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { BrandMark, Icon } from './components/Icon';
import { roleLabel } from './format';
import { useApi } from './hooks';
import { navigate, useHashRoute } from './nav';
import { Admin } from './pages/Admin';
import { Batches } from './pages/Batches';
import { BackdateAccess } from './pages/BackdateAccess';
import { Claims } from './pages/Claims';
import { CommunityClaims } from './pages/CommunityClaims';
import { CsoPortal } from './pages/CsoPortal';
import { Dashboard } from './pages/Dashboard';
import { FinanceMonthlyReport } from './pages/FinanceMonthlyReport';
import { MonthlyServicesBudgets } from './pages/MonthlyServicesBudgets';
import { ChangePasswordForm, ForcedPasswordChange } from './pages/ChangePassword';
import { Login } from './pages/Login';
import { MyWorkLogs } from './pages/MyWorkLogs';
import { Organizations } from './pages/Organizations';
import { PrintWorkLog } from './pages/PrintWorkLog';
import { ProviderPaymentDetails } from './pages/ProviderPaymentDetails';
import { PayPeriods } from './pages/PayPeriods';
import { SalaryAmounts } from './pages/SalaryAmounts';
import { PublicHolidays } from './pages/PublicHolidays';
import { ReviewWorkLogs } from './pages/ReviewWorkLogs';
import { RoutingQueue } from './pages/RoutingQueue';
import { Rates } from './pages/Rates';
import { ReviewCadres } from './pages/ReviewCadres';
import { Staff } from './pages/Staff';
import { Modal } from './components/ui';
import { Home } from './pages/Home';
import { useTheme } from './theme';
import { WorkLogSummary } from './types';

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
  rates: 'Viwango vya huduma', 'pay-periods': 'Vipindi vya malipo', 'public-holidays': 'Sikukuu', 'routing-queue': 'Huduma za kukagua', 'finance-monthly': 'Ripoti ya mwezi',
  'review-cadres': 'Mgawo wa wakaguzi', worklogs: 'Mapitio ya majedwali', claims: 'Madai ya malipo', batches: 'Makundi ya malipo', budgets: 'Bajeti ya huduma',
  'salary-amounts': 'Viwango vya mishahara', cso: 'Malipo ya CSO', 'community-claims': 'Madai ya jamii', staff: 'Daftari la watumishi', organizations: 'Mashirika na mikoa', admin: 'Utawala',
};
const DESCRIPTIONS_SW: Record<string, string> = {
  'my-logs': 'Rekodi kazi zako za kila siku na uwasilishe tarehe 25', 'payment-details': 'Dhibiti akaunti yako ya benki na namba ya simu ya malipo',
  'backdate-access': 'Toa ruhusa ya muda kufungua tarehe iliyopita', rates: 'Ongeza huduma, viwango vyake vya kila siku na siku za chini kabisa',
  'pay-periods': 'Ratiba za kazi na malipo za mikoa', 'public-holidays': 'Sikukuu zinazoonekana kwenye kalenda na majedwali',
  'routing-queue': 'Idhinisha majedwali na malipo, kisha tuma Fedha Kuu', 'finance-monthly': 'Jumla ya kazi zilizoidhinishwa kwa kila mwezi wa kazi',
  'review-cadres': 'Dhibiti kada na maeneo ya kila mkaguzi', worklogs: 'Soma na uamue majedwali yaliyo katika eneo lako', claims: 'Fuatilia madai kutoka idhini hadi malipo',
  batches: 'Faili za malipo na stakabadhi', budgets: 'Bajeti za huduma za mikoa na makato yake', 'salary-amounts': 'Mshahara kamili wa kila ngazi',
  cso: 'Malipo yako, uthibitisho na majedwali ya mishahara', 'community-claims': 'Madai ya jamii na malipo yake', staff: 'Sajili watumishi, vituo vyao na akaunti zao',
  organizations: 'Mashirika na mikoa yanayohudumia', admin: 'Watumiaji, mipangilio na ukaguzi',
};
const GROUPS_SW: Record<string, string> = { Overview: 'Muhtasari', Work: 'Kazi', Finance: 'Fedha', Registry: 'Daftari', System: 'Mfumo' };
/** The bottom bar on phones: the pages a role opens most, in order. */
const PHONE_LABELS: Record<string, { en: string; sw: string }> = {
  home: { en: 'Home', sw: 'Mwanzo' }, 'my-logs': { en: 'My logs', sw: 'Kazi' }, worklogs: { en: 'Reviews', sw: 'Mapitio' }, 'routing-queue': { en: 'Services', sw: 'Huduma' },
  cso: { en: 'Payments', sw: 'Malipo' }, claims: { en: 'Claims', sw: 'Madai' }, staff: { en: 'Staff', sw: 'Watumishi' }, 'community-claims': { en: 'Community', sw: 'Jamii' }, dashboard: { en: 'Overview', sw: 'Muhtasari' },
};
const PHONE_PAGES = ['my-logs', 'worklogs', 'routing-queue', 'cso', 'claims', 'staff', 'community-claims', 'dashboard'];

export const PAGES: Page[] = [
  { key: 'home', label: 'Home', description: 'What is waiting for you today', icon: 'home', group: 'Overview', roles: EVERY_ROLE, render: () => <Home /> },
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Work approvals, claims and payment progress at a glance',
    icon: 'dashboard',
    group: 'Overview',
    roles: ['OVERSIGHT', 'RPM', 'REGIONAL_FINANCE', 'TECHNICAL_OFFICER', 'CSO_TECHNICAL_OFFICER', 'SUPERVISOR', 'FHI360_FINANCE', 'CSO_FINANCE', 'CENTRAL_ADMIN', 'REGIONAL_ADMIN'],
    render: () => <Dashboard />,
  },
  { key: 'my-logs', label: 'My work logs', description: 'Record your daily work and confirm verified logs', icon: 'calendar', group: 'Work', roles: ['PROVIDER'], render: () => <MyWorkLogs /> },
  { key: 'payment-details', label: 'Payment details', description: 'Manage your payroll bank account and service mobile wallet', icon: 'wallet', group: 'Work', roles: ['PROVIDER'], render: () => <ProviderPaymentDetails /> },
  { key: 'backdate-access', label: 'Backdated entry access', description: 'Grant time-limited access to reopen a date-specific work log', icon: 'calendar', group: 'Work', roles: ['TECHNICAL_OFFICER', 'SUPER_ADMIN'], render: () => <BackdateAccess /> },
  { key: 'rates', label: 'Service amounts', description: 'Add services, their daily amounts and minimum days', icon: 'receipt', group: 'Finance', roles: ['TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'OVERSIGHT', 'SUPER_ADMIN'], render: () => <Rates /> },
  { key: 'pay-periods', label: 'Pay periods', description: 'Set regional work and pay schedules', icon: 'calendar', group: 'Finance', roles: ['TECHNICAL_OFFICER', 'CENTRAL_ADMIN', 'FHI360_FINANCE', 'SUPER_ADMIN'], render: () => <PayPeriods /> },
  { key: 'public-holidays', label: 'Public holidays', description: 'Holidays shown on calendars and timesheets', icon: 'calendar', group: 'System', roles: ['CENTRAL_ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN'], render: () => <PublicHolidays /> },
  { key: 'routing-queue', label: 'Services to review', description: 'Verify the assignment, then choose the organization that should pay', icon: 'route', group: 'Finance', roles: ['REGIONAL_FINANCE', 'SUPER_ADMIN'], render: () => <RoutingQueue /> },
  { key: 'finance-monthly', label: 'Monthly work report', description: 'Pay-month approved work totals and activity indicators across cadres', icon: 'calendar', group: 'Finance', roles: ['REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'SUPER_ADMIN'], render: () => <FinanceMonthlyReport /> },
  { key: 'review-cadres', label: 'Review assignments', description: 'Manage reviewer cadre and geographic scope', icon: 'users', group: 'System', roles: ['SYSTEM_ADMIN', 'SUPER_ADMIN'], render: () => <ReviewCadres /> },
  {
    key: 'worklogs',
    label: 'Timesheet reviews',
    description: 'Read and decide the timesheets in your scope',
    icon: 'clipboard',
    group: 'Work',
    roles: [...REVIEWERS, 'OVERSIGHT', 'FHI360_FINANCE'],
    render: (target) => <ReviewWorkLogs initialType={target === 'PAYROLL' || target === 'SERVICES' ? target : undefined} />,
  },
  {
    key: 'claims',
    label: 'Payment claims',
    description: 'Prepare, approve and track claims across routes A, B and C',
    icon: 'receipt',
    group: 'Finance',
    roles: ['FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT', 'COMMUNITY_VERIFIER', 'PROVIDER'],
    render: () => <Claims />,
  },
  { key: 'batches', label: 'Payment batches', description: 'Payment exports, older FHI360 → CSO handoffs and receipts', icon: 'layers', group: 'Finance', roles: ['FHI360_FINANCE', 'CSO_FINANCE', 'OVERSIGHT'], render: () => <Batches /> },
  { key: 'budgets', label: 'Service budgets', description: 'Monthly regional Services budgets and submission deductions', icon: 'wallet', group: 'Finance', roles: ['REGIONAL_FINANCE', 'FHI360_FINANCE', 'SUPER_ADMIN'], render: () => <MonthlyServicesBudgets /> },
  { key: 'salary-amounts', label: 'Salary amounts', description: 'Full monthly salary for each salary scale', icon: 'wallet', group: 'Finance', roles: ['FHI360_FINANCE', 'SUPER_ADMIN'], render: () => <SalaryAmounts /> },
  { key: 'cso', label: 'CSO payments', description: 'Your pending payments, proof, reconciliation and salary timesheets', icon: 'wallet', group: 'Finance', roles: ['CSO_FINANCE'], render: (target) => <CsoPortal initialSection={target === 'salary' ? 'export' : undefined} /> },
  { key: 'community-claims', label: 'Community claims', description: 'Period-based community claims and direct payment', icon: 'users', group: 'Finance', roles: ['PROVIDER', 'COMMUNITY_VERIFIER', 'TECHNICAL_OFFICER', 'CSO_FINANCE', 'OVERSIGHT', 'SUPER_ADMIN'], render: () => <CommunityClaims /> },
  {
    key: 'staff',
    label: 'Staff registry',
    description: 'One identity per person, assignments and rotations',
    icon: 'users',
    group: 'Registry',
    roles: ['CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'CSO_FINANCE', 'SYSTEM_ADMIN', 'FHI360_FINANCE', 'OVERSIGHT'],
    render: () => <Staff />,
  },
  {
    key: 'organizations',
    label: 'Organizations / CSO regions',
    description: 'Govern organization access to regional allocations',
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
  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'sw';
  }, [lang]);
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
        <PrintWorkLog logId={Number(route.id)} />
      </main>
    );

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <BrandMark />
          <div>
            <div className="brand-name">HRH Pay</div>
            <div className="brand-sub">Work logs · Claims · Payroll</div>
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
                    <button key={p.key} type="button" title={p.description} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => { setMenuOpen(false); navigate(p.key); }}>
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
        <div className="sidebar-foot">
          <Icon name="shield" size={16} />
          <span>{lang === 'sw' ? 'Malipo hufanyika nje ya mfumo huu na hurekodiwa kwa uthibitisho.' : 'Payments are executed outside this system and recorded with proof.'}</span>
        </div>
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
              <div className={banded ? 'banded' : undefined}>{current.render(route.id || undefined)}</div>
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
