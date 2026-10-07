import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateTime, roleLabel } from '../../format';
import { useAction, useApi } from '../../hooks';
import { AdminUser, RoleInfo, UserScope } from '../../types';
import { Alert, AsyncState, Drawer, Facts, Field, StatusBadge } from '../../components/ui';
import { Row, matches, nameMap, refName, useLookups } from './common';

type Dim = 'region_id' | 'cluster_id' | 'facility_id' | 'community_area_id' | 'organization_id';
/** One scope row; `dim` remembers the chosen dimension while no value is picked yet (editor only, never sent). */
type ScopeIn = Record<Dim, number | null> & { dim?: Dim };

const DIMS: { key: Dim; label: string; path: string }[] = [
  { key: 'region_id', label: 'Region', path: '/admin/regions' },
  { key: 'cluster_id', label: 'Cluster', path: '/admin/clusters' },
  { key: 'facility_id', label: 'Facility', path: '/admin/facilities' },
  { key: 'community_area_id', label: 'Community area', path: '/admin/community-areas' },
  { key: 'organization_id', label: 'Organization', path: '/admin/organizations' },
];
const DIM_PATHS = DIMS.map((d) => d.path);
const PHONE_RE = /^\+?\d{9,15}$/;

type Maps = Record<Dim, Map<string, string>>;

function useScopeMaps() {
  const { lists, error } = useLookups(DIM_PATHS);
  const maps = useMemo(() => {
    const out = {} as Maps;
    DIMS.forEach((d) => {
      out[d.key] = nameMap(lists[d.path]);
    });
    return out;
  }, [lists]);
  return { lists, maps, error };
}

const emptyScope = (): ScopeIn => ({ region_id: null, cluster_id: null, facility_id: null, community_area_id: null, organization_id: null });

function toScopeIn(s: UserScope): ScopeIn {
  return {
    region_id: s.region_id,
    cluster_id: s.cluster_id,
    facility_id: s.facility_id,
    community_area_id: s.community_area_id,
    organization_id: s.organization_id,
  };
}

function scopeText(s: ScopeIn | UserScope, maps: Maps): string {
  const parts = DIMS.filter((d) => s[d.key] !== null && s[d.key] !== undefined).map((d) => `${d.label}: ${refName(maps[d.key], s[d.key])}`);
  return parts.length ? parts.join(' + ') : 'Empty scope';
}

/** Rows of "dimension + value". Scopes that combine several dimensions are kept as-is (remove only). */
function ScopeEditor({
  scopes,
  onChange,
  lists,
  maps,
  disabled,
}: {
  scopes: ScopeIn[];
  onChange: (s: ScopeIn[]) => void;
  lists: Record<string, Row[]>;
  maps: Maps;
  disabled: boolean;
}) {
  const update = (i: number, next: ScopeIn) => onChange(scopes.map((s, j) => (j === i ? next : s)));
  return (
    <fieldset className="stack">
      <legend>Scopes</legend>
      <p className="muted small">
        Scopes limit which regions, clusters, facilities, community areas or organizations a user can see and act on. Leave empty for roles
        with a global view.
      </p>
      {scopes.length === 0 && <p className="muted">No scopes.</p>}
      {scopes.map((s, i) => {
        const set = DIMS.filter((d) => s[d.key] !== null);
        const remove = (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(scopes.filter((_, j) => j !== i))} disabled={disabled}>
            Remove
          </button>
        );
        if (set.length > 1) {
          return (
            <div key={i} className="row">
              <span>{scopeText(s, maps)}</span>
              {remove}
            </div>
          );
        }
        const dim = set[0] || DIMS.find((d) => d.key === s.dim) || DIMS[0];
        const options = lists[dim.path] || [];
        return (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <Field label={`Scope ${i + 1}: dimension`}>
              <select
                value={dim.key}
                disabled={disabled}
                onChange={(e) => update(i, { ...emptyScope(), dim: e.target.value as Dim })}
              >
                {DIMS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Scope ${i + 1}: ${dim.label.toLowerCase()}`}>
              <select
                value={s[dim.key] === null ? '' : String(s[dim.key])}
                disabled={disabled}
                required
                onChange={(e) => update(i, { ...emptyScope(), dim: dim.key, [dim.key]: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={String(o.id)} value={String(o.id)}>
                    {String(o.name)}
                  </option>
                ))}
              </select>
            </Field>
            {remove}
          </div>
        );
      })}
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange([...scopes, emptyScope()])} disabled={disabled}>
          Add scope
        </button>
      </div>
    </fieldset>
  );
}

/** Strip editor-only keys and check every row names something. */
function cleanScopes(scopes: ScopeIn[]): { scopes: ScopeIn[]; error: string | null } {
  const out = scopes.map((s) => {
    const clean = emptyScope();
    DIMS.forEach((d) => {
      clean[d.key] = s[d.key];
    });
    return clean;
  });
  if (out.some((s) => DIMS.every((d) => s[d.key] === null))) return { scopes: out, error: 'Choose a value for every scope row, or remove the empty row.' };
  return { scopes: out, error: null };
}

function RoleChecks({
  roles,
  value,
  onChange,
  disabled,
}: {
  roles: RoleInfo[] | null;
  value: string[];
  onChange: (r: string[]) => void;
  disabled: boolean;
}) {
  if (!roles) return <p className="muted">Loading roles…</p>;
  return (
    <fieldset className="stack">
      <legend>Roles</legend>
      {roles.map((r) => (
        <label key={r.name} className="row" style={{ alignItems: 'flex-start' }}>
          <input
            type="checkbox"
            checked={value.includes(r.name)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? [...value, r.name] : value.filter((x) => x !== r.name))}
          />
          <span>
            <strong>{roleLabel(r.name)}</strong>
            <br />
            <span className="muted small">{r.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function CreateUser({ roles, onDone, onCancel }: { roles: RoleInfo[] | null; onDone: (u: AdminUser) => void; onCancel: () => void }) {
  const { lists, maps, error: lookupError } = useScopeMaps();
  const [form, setForm] = useState({ username: '', password: '', full_name: '', phone: '', email: '', preferred_language: 'sw', staff_id: '' });
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [scopes, setScopes] = useState<ScopeIn[]>([]);
  const { busy, error, setError, run } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) return setError('The password must be at least 8 characters.');
    if (!PHONE_RE.test(form.phone.trim())) return setError('Enter the phone number as 9–15 digits, optionally starting with +, e.g. +255712345678.');
    if (!userRoles.length) return setError('Choose at least one role.');
    const cleaned = cleanScopes(scopes);
    if (cleaned.error) return setError(cleaned.error);
    const staffId = form.staff_id.trim() ? Number(form.staff_id) : null;
    if (staffId !== null && !Number.isInteger(staffId)) return setError('Staff ID must be a whole number.');
    const created = await run(() =>
      api.post<AdminUser>('/admin/users', {
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        preferred_language: form.preferred_language,
        roles: userRoles,
        scopes: cleaned.scopes,
        staff_id: staffId,
      }),
    );
    if (created) onDone(created);
    return undefined;
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-2">
        <Field label="Username *">
          <input value={form.username} onChange={set('username')} required minLength={3} maxLength={100} autoComplete="off" />
        </Field>
        <Field label="Initial password *" hint="At least 8 characters. Share it with the user securely.">
          <input type="password" value={form.password} onChange={set('password')} required minLength={8} maxLength={72} autoComplete="new-password" />
        </Field>
        <Field label="Full name *">
          <input value={form.full_name} onChange={set('full_name')} required maxLength={255} />
        </Field>
        <Field label="Phone *" hint="e.g. +255712345678">
          <input type="tel" value={form.phone} onChange={set('phone')} required pattern="\+?\d{9,15}" />
        </Field>
        <Field label="Email">
          <input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Preferred language">
          <select value={form.preferred_language} onChange={set('preferred_language')}>
            <option value="sw">Kiswahili</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label="Staff record ID" hint="Optional: links this login to an existing staff record (ID from the Staff page) that has no login yet.">
          <input type="number" inputMode="numeric" min={1} step={1} value={form.staff_id} onChange={set('staff_id')} />
        </Field>
      </div>
      <RoleChecks roles={roles} value={userRoles} onChange={setUserRoles} disabled={busy} />
      <Alert>{lookupError}</Alert>
      <ScopeEditor scopes={scopes} onChange={setScopes} lists={lists} maps={maps} disabled={busy} />
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ManageUser({ user, roles, onChanged }: { user: AdminUser; roles: RoleInfo[] | null; onChanged: (u: AdminUser) => void }) {
  const { me } = useAuth();
  const { lists, maps, error: lookupError } = useScopeMaps();
  const [userRoles, setUserRoles] = useState<string[]>(user.roles);
  const [rolesReason, setRolesReason] = useState('');
  const [scopes, setScopes] = useState<ScopeIn[]>(user.scopes.map(toScopeIn));
  const [scopesReason, setScopesReason] = useState('');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState<{ part: 'roles' | 'scopes' | 'password' | 'status'; msg: string } | null>(null);
  const doneMsg = (part: 'roles' | 'scopes' | 'password' | 'status') => (done?.part === part ? done.msg : null);
  const rolesAction = useAction();
  const scopesAction = useAction();
  const pwAction = useAction();
  const deactivateAction = useAction();
  const isMe = me?.id === user.id;

  const saveRoles = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRoles.length) return rolesAction.setError('Choose at least one role.');
    if (rolesReason.trim().length < 3) return rolesAction.setError('Give a reason (at least 3 characters).');
    const u = await rolesAction.run(() => api.put<AdminUser>(`/admin/users/${user.id}/roles`, { roles: userRoles, reason: rolesReason.trim() }));
    if (u) {
      setRolesReason('');
      onChanged(u);
      setDone({ part: 'roles', msg: 'Roles saved.' });
    }
    return undefined;
  };

  const saveScopes = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanScopes(scopes);
    if (cleaned.error) return scopesAction.setError(cleaned.error);
    if (scopesReason.trim().length < 3) return scopesAction.setError('Give a reason (at least 3 characters).');
    const u = await scopesAction.run(() => api.put<AdminUser>(`/admin/users/${user.id}/scopes`, { scopes: cleaned.scopes, reason: scopesReason.trim() }));
    if (u) {
      setScopesReason('');
      onChanged(u);
      setDone({ part: 'scopes', msg: 'Scopes saved.' });
    }
    return undefined;
  };

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setDone(null);
    if (password.length < 8) return pwAction.setError('The new password must be at least 8 characters.');
    if (!window.confirm(`Set a new password for ${user.username}? Their current password stops working immediately.`)) return undefined;
    const ok = await pwAction.run(async () => {
      await api.post(`/admin/users/${user.id}/reset-password`, { new_password: password });
      return true;
    });
    if (ok) {
      setPassword('');
      setDone({ part: 'password', msg: `Password reset for ${user.username}. Share the new password with them securely.` });
    }
    return undefined;
  };

  const deactivate = async () => {
    if (!window.confirm(`Deactivate ${user.username}? They will no longer be able to sign in.`)) return;
    const u = await deactivateAction.run(() => api.post<AdminUser>(`/admin/users/${user.id}/deactivate`));
    if (u) {
      onChanged(u);
      setDone({ part: 'status', msg: `${user.username} was deactivated. They can no longer sign in.` });
    }
  };

  return (
    <div className="stack-lg">
      <Alert kind="success">{doneMsg('status')}</Alert>
      <Facts
        items={[
          ['Username', user.username],
          ['Full name', user.full_name],
          ['Phone', user.phone],
          ['Email', user.email],
          ['Language', user.preferred_language === 'en' ? 'English' : 'Kiswahili'],
          ['Status', <StatusBadge key="s" status={user.is_active ? 'ACTIVE' : 'INACTIVE'} />],
          ['Last sign-in', dateTime(user.last_login_at)],
          ['Staff record', user.staff_id ? `#${user.staff_id}` : null],
        ]}
      />

      <form className="stack card" onSubmit={saveRoles}>
        <RoleChecks roles={roles} value={userRoles} onChange={setUserRoles} disabled={rolesAction.busy} />
        {isMe && <p className="muted small">You cannot remove your own System Admin role.</p>}
        <Field label="Reason for the role change (required)">
          <input value={rolesReason} onChange={(e) => setRolesReason(e.target.value)} minLength={3} maxLength={500} />
        </Field>
        <Alert>{rolesAction.error}</Alert>
        <Alert kind="success">{doneMsg('roles')}</Alert>
        <div>
          <button className="btn btn-primary" disabled={rolesAction.busy || rolesReason.trim().length < 3}>
            {rolesAction.busy ? 'Saving…' : 'Save roles'}
          </button>
        </div>
      </form>

      <form className="stack card" onSubmit={saveScopes}>
        <Alert>{lookupError}</Alert>
        <ScopeEditor scopes={scopes} onChange={setScopes} lists={lists} maps={maps} disabled={scopesAction.busy} />
        <Field label="Reason for the scope change (required)">
          <input value={scopesReason} onChange={(e) => setScopesReason(e.target.value)} minLength={3} maxLength={500} />
        </Field>
        <Alert>{scopesAction.error}</Alert>
        <Alert kind="success">{doneMsg('scopes')}</Alert>
        <div>
          <button className="btn btn-primary" disabled={scopesAction.busy || scopesReason.trim().length < 3}>
            {scopesAction.busy ? 'Saving…' : 'Save scopes'}
          </button>
        </div>
      </form>

      <form className="stack card" onSubmit={resetPassword}>
        <h3>Reset password</h3>
        <Field label="New password" hint="At least 8 characters.">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={72} autoComplete="new-password" />
        </Field>
        <Alert>{pwAction.error}</Alert>
        <Alert kind="success">{doneMsg('password')}</Alert>
        <div>
          <button className="btn btn-secondary" disabled={pwAction.busy || password.length < 8}>
            {pwAction.busy ? 'Saving…' : 'Set new password'}
          </button>
        </div>
      </form>

      {user.is_active && !isMe && (
        <div className="stack card">
          <h3>Deactivate</h3>
          <p className="muted">The user can no longer sign in. Their history and audit trail are kept.</p>
          <Alert>{deactivateAction.error}</Alert>
          <div>
            <button className="btn btn-danger" onClick={deactivate} disabled={deactivateAction.busy}>
              {deactivateAction.busy ? 'Working…' : 'Deactivate user'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function UsersSection() {
  const { data, error, loading, reload, setData } = useApi<AdminUser[]>('/admin/users');
  const { data: roles, error: rolesError } = useApi<RoleInfo[]>('/admin/roles');
  const { maps } = useScopeMaps();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = data?.find((u) => u.id === selectedId) || null;

  const rows = (data || []).filter(
    (u) =>
      (showInactive || u.is_active) &&
      (!roleFilter || u.roles.includes(roleFilter)) &&
      matches(query, u.username, u.full_name, u.phone, u.email, ...u.roles.map(roleLabel)),
  );

  return (
    <section className="card stack">
      <div className="section-head">
        <h3>Users</h3>
        <button
          className="btn btn-primary"
          onClick={() => {
            setNotice(null);
            setCreating(true);
          }}
        >
          New user
        </button>
      </div>
      <Alert kind="success">{notice}</Alert>
      <Alert>{rolesError}</Alert>
      <div className="filters">
        <Field label="Search">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, username, phone" />
        </Field>
        <Field label="Role">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {(roles || []).map((r) => (
              <option key={r.name} value={r.name}>
                {roleLabel(r.name)}
              </option>
            ))}
          </select>
        </Field>
        <label className="row-inline">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show deactivated users
        </label>
      </div>
      <AsyncState data={data} error={error} loading={loading} empty="No users yet.">
        {() =>
          rows.length === 0 ? (
            <p className="empty">No users match these filters.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Full name</th>
                    <th>Phone</th>
                    <th>Roles</th>
                    <th>Scopes</th>
                    <th>Status</th>
                    <th>Last sign-in</th>
                    <th>Staff</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td className="nowrap">{u.username}</td>
                      <td>{u.full_name}</td>
                      <td className="nowrap">{u.phone || '—'}</td>
                      <td>
                        <span className="badges">
                          {u.roles.map((r) => (
                            <span key={r} className="badge badge-neutral">
                              {roleLabel(r)}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="small">
                        {u.scopes.length ? u.scopes.map((s, i) => <div key={s.id ?? i}>{scopeText(s, maps)}</div>) : <span className="muted">All</span>}
                      </td>
                      <td>
                        <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
                      </td>
                      <td className="nowrap">{dateTime(u.last_login_at)}</td>
                      <td>{u.staff_id ? `#${u.staff_id}` : '—'}</td>
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setNotice(null);
                            setSelectedId(u.id);
                          }}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncState>
      {creating && (
        <Drawer title="New user" onClose={() => setCreating(false)} wide>
          <CreateUser
            roles={roles}
            onCancel={() => setCreating(false)}
            onDone={(u) => {
              setCreating(false);
              setNotice(`User ${u.username} created.`);
              reload();
            }}
          />
        </Drawer>
      )}
      {selected && (
        <Drawer title={`Manage ${selected.username}`} onClose={() => setSelectedId(null)} wide>
          <ManageUser
            key={selected.id}
            user={selected}
            roles={roles}
            onChanged={(u) => setData((list) => (list ? list.map((x) => (x.id === u.id ? u : x)) : list))}
          />
        </Drawer>
      )}
    </section>
  );
}
