import React, { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { qs } from '../api';
import { useApi } from '../hooks';
import { humanize } from '../format';
import { Assignment, Cadre, StaffSummary } from '../types';
import { Alert, AsyncState, Field, StatusBadge } from '../components/ui';
import { StaffDrawer } from '../components/staff/StaffDrawer';
import { CreateStaffModal } from '../components/staff/StaffForms';
import { ChangeRequests } from '../components/staff/ChangeRequests';
import { RosterImport } from '../components/staff/RosterImport';

type Tab = 'registry' | 'requests' | 'import';

function assignmentText(a: Assignment | null): React.ReactNode {
  if (!a) return <span className="muted">No current assignment</span>;
  const place = a.facility || a.community_area || a.ward || a.district;
  return (
    <>
      {a.region}
      {place ? ` · ${place}` : ''}
      {a.section ? <span className="muted"> · {a.section}</span> : null}
    </>
  );
}

function Registry({ cadres }: { cadres: Cadre[] }) {
  const { hasRole } = useAuth();
  const canCreate = hasRole('CENTRAL_ADMIN', 'REGIONAL_ADMIN');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [cadre, setCadre] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const { data, error, loading, reload } = useApi<StaffSummary[]>(`/staff${qs({ search, status, cadre })}`);
  const cadreName = (code: string) => cadres.find((c) => c.code === code)?.name || code;

  return (
    <div className="stack">
      <div className="row-between">
        <div className="filters">
          <Field label="Search">
            <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Name or phone" />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="EXITED">Exited</option>
            </select>
          </Field>
          <Field label="Cadre">
            <select value={cadre} onChange={(e) => setCadre(e.target.value)}>
              <option value="">All cadres</option>
              {cadres.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {canCreate && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={!cadres.length}>
            Register staff member
          </button>
        )}
      </div>
      <Alert kind="success">{notice}</Alert>
      <AsyncState data={data} error={error} loading={loading} empty="No staff members match these filters.">
        {(rows) => (
          <>
            <div className="table-wrap">
              <table className="clickable">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Cadre</th>
                    <th>Occupation</th>
                    <th>Status</th>
                    <th>Phone</th>
                    <th>Login</th>
                    <th>Enrolled via</th>
                    <th>Current assignment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      tabIndex={0}
                      onClick={() => setOpenId(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setOpenId(s.id);
                      }}
                    >
                      <td>
                        <strong>{s.legal_name}</strong>
                      </td>
                      <td title={cadreName(s.cadre)}>{s.cadre}</td>
                      <td>{s.occupation || '—'}</td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="nowrap">{s.phone}</td>
                      <td>{s.has_login ? 'Yes' : <span className="muted">No</span>}</td>
                      <td>{humanize(s.enrollment_source)}</td>
                      <td>{assignmentText(s.current_assignment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length >= 500 && <p className="muted small">Showing the first 500 matches. Narrow the search to see more.</p>}
          </>
        )}
      </AsyncState>
      {openId !== null && <StaffDrawer staffId={openId} cadres={cadres} onClose={() => setOpenId(null)} onChanged={reload} />}
      {creating && (
        <CreateStaffModal
          cadres={cadres}
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            setNotice(`${s.legal_name} registered.`);
            reload();
            setOpenId(s.id);
          }}
        />
      )}
    </div>
  );
}

export function Staff() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('CENTRAL_ADMIN', 'REGIONAL_ADMIN');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'registry', label: 'Registry' },
    ...(isAdmin || hasRole('CSO_FINANCE') ? [{ key: 'requests' as Tab, label: 'Change requests' }] : []),
    ...(isAdmin ? [{ key: 'import' as Tab, label: 'Roster import' }] : []),
  ];
  const [tab, setTab] = useState<Tab>('registry');
  const cadres = useApi<Cadre[]>('/admin/cadres');

  return (
    <div className="stack-lg">
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
      <Alert>{cadres.error && `Could not load cadres: ${cadres.error}`}</Alert>
      {tab === 'registry' && <Registry cadres={cadres.data || []} />}
      {tab === 'requests' && <ChangeRequests cadres={cadres.data || []} />}
      {tab === 'import' && <RosterImport />}
    </div>
  );
}
