import React, { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { BrandMark, Icon } from './components/Icon';
import { roleLabel } from './format';
import { useApi } from './hooks';
import { navigate, useHashRoute } from './nav';
import { Admin } from './pages/Admin';
import { Batches } from './pages/Batches';
import { BackdateAccess } from './pages/BackdateAccess';
import { Budgets } from './pages/Budgets';
import { Claims } from './pages/Claims';
import { CsoPortal } from './pages/CsoPortal';
import { Dashboard } from './pages/Dashboard';
import { ChangePasswordForm, ForcedPasswordChange } from './pages/ChangePassword';
import { Login } from './pages/Login';
import { MyWorkLogs } from './pages/MyWorkLogs';
import { Organizations } from './pages/Organizations';
import { PrintWorkLog } from './pages/PrintWorkLog';
import { PayPeriods } from './pages/PayPeriods';
import { ReviewWorkLogs } from './pages/ReviewWorkLogs';
import { RoutingQueue } from './pages/RoutingQueue';
import { Rates } from './pages/Rates';
import { ReviewCadres } from './pages/ReviewCadres';
import { Staff } from './pages/Staff';
import { Modal } from './components/ui';
import { useTheme } from './theme';
import { WorkLogSummary } from './types';

const REVIEWERS = ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE'];

interface Page {
  key: string;
  label: string;
  description: string;
  icon: string;
  group: string;
  roles: string[];
  render: () => React.ReactNode;
}

const PAGES: Page[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Pipeline, queues, claims and budgets at a glance',
    icon: 'dashboard',
    group: 'Overview',
    roles: ['OVERSIGHT', 'RPM', 'REGIONAL_FINANCE', 'TECHNICAL_OFFICER', 'SUPERVISOR', 'FHI360_FINANCE', 'CSO_FINANCE', 'CENTRAL_ADMIN', 'REGIONAL_ADMIN'],
    render: () => <Dashboard />,
  },
  { key: 'my-logs', label: 'My work logs', description: 'Record your daily work and confirm verified logs', icon: 'calendar', group: 'Work', roles: ['PROVIDER'], render: () => <MyWorkLogs /> },
  { key: 'backdate-access', label: 'Backdated entry access', description: 'Grant time-limited access to reopen a date-specific work log', icon: 'calendar', group: 'Work', roles: ['TECHNICAL_OFFICER', 'SUPER_ADMIN'], render: () => <BackdateAccess /> },
  { key: 'rates', label: 'Rates', description: 'Scoped activity rates and immutable revisions', icon: 'receipt', group: 'Finance', roles: ['TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'OVERSIGHT', 'SUPER_ADMIN'], render: () => <Rates /> },
  { key: 'pay-periods', label: 'Pay periods', description: 'Set regional work and pay schedules', icon: 'calendar', group: 'Finance', roles: ['TECHNICAL_OFFICER', 'CENTRAL_ADMIN', 'FHI360_FINANCE', 'SUPER_ADMIN'], render: () => <PayPeriods /> },
  { key: 'routing-queue', label: 'Routing queue', description: 'Verify the assignment, then choose the organization that should pay', icon: 'route', group: 'Finance', roles: ['REGIONAL_FINANCE', 'SUPER_ADMIN'], render: () => <RoutingQueue /> },
  { key: 'review-cadres', label: 'Review assignments', description: 'Manage reviewer cadre and geographic scope', icon: 'users', group: 'System', roles: ['TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'SUPER_ADMIN'], render: () => <ReviewCadres /> },
  {
    key: 'worklogs',
    label: 'Work log reviews',
    description: 'Verify, endorse and authorize work logs in your scope',
    icon: 'clipboard',
    group: 'Work',
    roles: [...REVIEWERS, 'OVERSIGHT', 'FHI360_FINANCE', 'CSO_FINANCE', 'COMMUNITY_VERIFIER'],
    render: () => <ReviewWorkLogs />,
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
  { key: 'batches', label: 'Payroll batches', description: 'Exports, FHI360 → CSO handoffs and receipts', icon: 'layers', group: 'Finance', roles: ['FHI360_FINANCE', 'CSO_FINANCE', 'OVERSIGHT'], render: () => <Batches /> },
  { key: 'cso', label: 'CSO payments', description: 'Your pending payments, proof and reconciliation', icon: 'wallet', group: 'Finance', roles: ['CSO_FINANCE'], render: () => <CsoPortal /> },
  { key: 'budgets', label: 'Budgets', description: 'Allocations, commitments, spend and tracker sync', icon: 'pie', group: 'Finance', roles: ['FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT'], render: () => <Budgets /> },
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
  const { me, loading, logout, hasRole } = useAuth();
  const route = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const pages = PAGES.filter((p) => hasRole(...p.roles));
  const defaultPage = pages[0];
  const current = pages.find((p) => p.key === route.page) || defaultPage;
  const isReviewer = hasRole(...REVIEWERS);
  // A super admin holds every role; naming them all would crowd the top bar.
  const roleSummary = me ? (me.roles.includes('SUPER_ADMIN') ? roleLabel('SUPER_ADMIN') : me.roles.map(roleLabel).join(', ')) : '';
  // Health workers also see their cadre, e.g. "Provider · Health Care Provider".
  const identity = me?.cadre ? `${roleSummary} · ${me.cadre.name}` : roleSummary;

  useEffect(() => setMenuOpen(false), [route.page]);
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
          {GROUPS.map((group) => {
            const items = pages.filter((p) => p.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="nav-group">
                <div className="nav-group-label">{group}</div>
                {items.map((p) => {
                  const active = p.key === current?.key;
                  return (
                    <button key={p.key} type="button" title={p.description} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => navigate(p.key)}>
                      <Icon name={p.icon} />
                      <span>{p.label}</span>
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
          <span>Payments are executed outside this system and recorded with proof.</span>
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
                <span className="crumb-group">{current.group}</span>
                <Icon name="chevron" size={14} />
                <span className="crumb-page" aria-current="page">
                  {current.label}
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
        <main className="content">
          {current ? (
            <React.Fragment key={current.key}>{current.render()}</React.Fragment>
          ) : (
            <p className="empty">Your account has no roles with pages yet. Ask an administrator.</p>
          )}
        </main>
      </div>
      {passwordOpen && (
        <Modal title="Change password" onClose={() => setPasswordOpen(false)}>
          <ChangePasswordForm onDone={() => setPasswordOpen(false)} />
        </Modal>
      )}
    </div>
  );
}

export default App;
