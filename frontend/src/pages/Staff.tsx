import { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { qs } from '../api';
import { useApi } from '../hooks';
import { CADRE_NAMES, cadreName, humanize, num } from '../format';
import { Assignment, Cadre, StaffSummary } from '../types';
import { Alert, AsyncState, Field, KpiStrip, PersonCell, StatusBadge } from '../components/ui';
import { StaffDrawer } from '../components/staff/StaffDrawer';
import { CreateStaffModal } from '../components/staff/StaffForms';
import { ChangeRequests } from '../components/staff/ChangeRequests';
import { RosterImport } from '../components/staff/RosterImport';
import './polish-admin.css';

type Tab = 'registry' | 'requests' | 'import';
/** The list API returns at most this many rows; past it the counts would only describe the first page. */
const LIST_LIMIT = 500;

const ENROLLMENT: Record<string, { en: string; sw: string }> = {
  ROSTER_IMPORT: { en: 'Roster import', sw: 'Uingizaji wa orodha' },
  ENGAGEMENT_LIST: { en: 'Engagement list', sw: 'Orodha ya ushiriki' },
  MANUAL: { en: 'Entered by hand', sw: 'Imeingizwa kwa mkono' },
};
const STATUS_SW: Record<string, string> = { ACTIVE: 'Yupo kazini', EXITED: 'Ameondoka' };

function AssignmentCell({ a, sw }: { a: Assignment | null; sw: boolean }) {
  if (!a) return <span className="muted">{sw ? 'Hana kituo kwa sasa' : 'No current assignment'}</span>;
  const place = a.facility || a.community_area || a.ward || a.district;
  const sub = [place ? a.region : null, a.section].filter(Boolean).join(' · ');
  return (
    <>
      <span className="cell-main">{place || a.region || '—'}</span>
      {sub && <span className="cell-sub">{sub}</span>}
    </>
  );
}

function Registry({ cadres }: { cadres: Cadre[] }) {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const canCreate = hasRole('CENTRAL_ADMIN', 'REGIONAL_ADMIN');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [cadre, setCadre] = useState('');
  const [justRegistered, setJustRegistered] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const { data, error, loading, reload } = useApi<StaffSummary[]>(`/staff${qs({ search, status, cadre })}`);
  // Known cadres get the reader's language; any other code keeps the name configured for it.
  const cadreLabel = (code: string) => (CADRE_NAMES[code] ? cadreName(code, lang) : cadres.find((c) => c.code === code)?.name || cadreName(code, lang));
  const filtered = !!(search || status || cadre);

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="filters">
          <Field label={sw ? 'Tafuta' : 'Search'}>
            <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder={sw ? 'Jina au simu' : 'Name or phone'} />
          </Field>
          <Field label={sw ? 'Hali' : 'Status'}>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{sw ? 'Wote' : 'All'}</option>
              <option value="ACTIVE">{sw ? STATUS_SW.ACTIVE : 'Active'}</option>
              <option value="EXITED">{sw ? STATUS_SW.EXITED : 'Exited'}</option>
            </select>
          </Field>
          <Field label={sw ? 'Kada' : 'Cadre'}>
            <select value={cadre} onChange={(e) => setCadre(e.target.value)}>
              <option value="">{sw ? 'Kada zote' : 'All cadres'}</option>
              {cadres.map((c) => (
                <option key={c.code} value={c.code}>
                  {cadreLabel(c.code)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {canCreate && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={!cadres.length}>
            {sw ? 'Sajili mtumishi' : 'Register staff member'}
          </button>
        )}
      </div>
      <Alert kind="success">{notice}</Alert>
      <AsyncState
        data={data}
        error={error}
        loading={loading}
        empty={filtered ? (sw ? 'Hakuna watumishi wanaolingana na vichujio hivi.' : 'No staff members match these filters.') : sw ? 'Bado hakuna watumishi waliosajiliwa.' : 'No staff registered yet.'}
      >
        {(rows) => {
          const active = rows.filter((s) => s.status === 'ACTIVE').length;
          const noLogin = rows.filter((s) => !s.has_login).length;
          const unplaced = rows.filter((s) => s.status === 'ACTIVE' && !s.current_assignment).length;
          return (
            <>
              {rows.length < LIST_LIMIT && (
                <KpiStrip
                  label={sw ? 'Muhtasari wa daftari' : 'Registry summary'}
                  items={[
                    { icon: 'users', label: filtered ? (sw ? 'Wanaolingana' : 'Matching staff') : sw ? 'Watumishi wote' : 'Staff registered', value: num(rows.length) },
                    { icon: 'check', tone: 'success', label: sw ? 'Wapo kazini' : 'Active', value: num(active), note: sw ? `${num(rows.length - active)} wameondoka` : `${num(rows.length - active)} exited` },
                    { icon: 'shield', tone: noLogin ? 'warn' : 'success', label: sw ? 'Hawana akaunti ya kuingia' : 'No sign-in yet', value: num(noLogin) },
                    { icon: 'route', tone: unplaced ? 'warn' : 'success', label: sw ? 'Wapo kazini bila kituo' : 'Active, no placement', value: num(unplaced) },
                  ]}
                />
              )}
              <div className="table-wrap">
                <table className="clickable">
                  <thead>
                    <tr>
                      <th>{sw ? 'Mtumishi' : 'Staff member'}</th>
                      <th>{sw ? 'Kada' : 'Cadre'}</th>
                      <th>{sw ? 'Hali' : 'Status'}</th>
                      <th>{sw ? 'Kituo cha sasa' : 'Current assignment'}</th>
                      <th>{sw ? 'Akaunti' : 'Login'}</th>
                      <th>{sw ? 'Alisajiliwa kupitia' : 'Enrolled via'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr
                        key={s.id}
                        tabIndex={0}
                        onClick={() => setOpenId(s.id)}
                        aria-label={`Open ${s.legal_name}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setOpenId(s.id);
                          }
                        }}
                      >
                        <td>
                          <PersonCell name={s.legal_name} sub={s.phone} />
                        </td>
                        <td title={s.cadre}>
                          <span className="cell-main">{cadreLabel(s.cadre)}</span>
                          {s.occupation && <span className="cell-sub">{s.occupation}</span>}
                        </td>
                        <td>
                          <StatusBadge status={s.status} label={sw ? STATUS_SW[s.status] : undefined} />
                        </td>
                        <td>
                          <AssignmentCell a={s.current_assignment} sw={sw} />
                        </td>
                        <td>{s.has_login ? (sw ? 'Ndiyo' : 'Yes') : <span className="muted">{sw ? 'Hapana' : 'No'}</span>}</td>
                        <td className="nowrap">{ENROLLMENT[s.enrollment_source]?.[sw ? 'sw' : 'en'] || humanize(s.enrollment_source)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length >= LIST_LIMIT && (
                <p className="table-foot">{sw ? `Inaonyesha watumishi ${LIST_LIMIT} wa kwanza. Punguza utafutaji.` : `Showing the first ${LIST_LIMIT} matches. Narrow the search.`}</p>
              )}
            </>
          );
        }}
      </AsyncState>
      {openId !== null && <StaffDrawer staffId={openId} cadres={cadres} onClose={() => { setOpenId(null); setJustRegistered(false); }} onChanged={reload} startLogin={justRegistered} />}
      {creating && (
        <CreateStaffModal
          cadres={cadres}
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            setNotice(sw ? `${s.legal_name} amesajiliwa.` : `${s.legal_name} registered.`);
            reload();
            setJustRegistered(true);
            setOpenId(s.id);
          }}
        />
      )}
    </div>
  );
}

export function Staff() {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const isAdmin = hasRole('CENTRAL_ADMIN', 'REGIONAL_ADMIN');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'registry', label: sw ? 'Daftari' : 'Registry' },
    ...(isAdmin || hasRole('CSO_FINANCE') ? [{ key: 'requests' as Tab, label: sw ? 'Maombi ya mabadiliko' : 'Change requests' }] : []),
    ...(isAdmin ? [{ key: 'import' as Tab, label: sw ? 'Ingiza orodha' : 'Roster import' }] : []),
  ];
  const [tab, setTab] = useState<Tab>('registry');
  const cadres = useApi<Cadre[]>('/admin/cadres');

  return (
    <div className="stack-lg staff-page">
      <div className="page-header">
        <h1>Staff registry</h1>
      </div>
      {tabs.length > 1 && (
        <nav className="subnav" aria-label="Staff sections">
          {tabs.map((t) => (
            <button key={t.key} type="button" aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
      )}
      <Alert>{cadres.error && `${sw ? 'Kada hazikupakia' : 'Could not load cadres'}: ${cadres.error}`}</Alert>
      {tab === 'registry' && <Registry cadres={cadres.data || []} />}
      {tab === 'requests' && <ChangeRequests cadres={cadres.data || []} />}
      {tab === 'import' && <RosterImport />}
    </div>
  );
}
