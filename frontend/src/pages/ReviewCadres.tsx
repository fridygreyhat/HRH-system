import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Field } from '../components/ui';
import { roleLabel } from '../format';
import { useAction, useApi } from '../hooks';
import { AdminUser, Cadre, Named, UserScope } from '../types';

const REVIEWER_ROLES = ['TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE'];
type ScopeDim = 'region_id' | 'cluster_id' | 'facility_id' | 'community_area_id' | 'organization_id';
type ScopeDraft = UserScope & { dim?: ScopeDim };
const SCOPE_DIMS: { key: ScopeDim; label: string; path: string }[] = [
  { key: 'region_id', label: 'Region', path: '/admin/regions' },
  { key: 'cluster_id', label: 'Cluster', path: '/admin/clusters' },
  { key: 'facility_id', label: 'Facility', path: '/admin/facilities' },
  { key: 'community_area_id', label: 'Community area', path: '/admin/community-areas' },
  { key: 'organization_id', label: 'Organization', path: '/admin/organizations' },
];
const emptyScope = (dim: ScopeDim = 'region_id'): ScopeDraft => ({
  region_id: null, cluster_id: null, facility_id: null, community_area_id: null, organization_id: null, dim,
});

function scopeDescription(scope: ScopeDraft): string {
  return SCOPE_DIMS.filter((item) => scope[item.key] !== null && scope[item.key] !== undefined)
    .map((item) => `${item.label} #${scope[item.key]}`).join(' + ');
}

export function ReviewCadres() {
  const { hasRole } = useAuth();
  const users = useApi<AdminUser[]>('/admin/users');
  const cadres = useApi<Cadre[]>('/admin/cadres');
  const regions = useApi<Named[]>('/admin/regions');
  const organizations = useApi<Named[]>('/admin/organizations');
  const [userId, setUserId] = useState('');
  const [cadreIds, setCadreIds] = useState<number[]>([]);
  const [scopeDrafts, setScopeDrafts] = useState<ScopeDraft[]>([]);
  const [cadreReason, setCadreReason] = useState('');
  const [scopeReason, setScopeReason] = useState('');
  const cadreAction = useAction();
  const scopeAction = useAction();
  const reviewers = (users.data || []).filter((user) => user.roles.some((role) => REVIEWER_ROLES.includes(role)));
  const selected = reviewers.find((user) => String(user.id) === userId);
  const lists: Record<ScopeDim, Named[]> = {
    region_id: regions.data || [],
    cluster_id: [],
    facility_id: [],
    community_area_id: [],
    organization_id: organizations.data || [],
  };
  const lookupsError = regions.error || organizations.error;

  const choose = (id: string) => {
    setUserId(id);
    const user = reviewers.find((candidate) => String(candidate.id) === id);
    setCadreIds(user?.review_cadre_ids || []);
    setScopeDrafts((user?.scopes || []).map((scope) => {
      const keys = SCOPE_DIMS.filter((item) => scope[item.key] !== null);
      return { ...scope, dim: keys.length === 1 ? keys[0].key : undefined };
    }));
    cadreAction.setError(null);
    scopeAction.setError(null);
  };
  const saveCadres = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (cadreReason.trim().length < 3) return cadreAction.setError('Give a reason of at least 3 characters.');
    const result = await cadreAction.run(() => api.put<AdminUser>(`/admin/users/${selected.id}/review-cadres`, { cadre_ids: cadreIds, reason: cadreReason.trim() }));
    if (result) {
      users.setData((rows) => rows?.map((row) => row.id === result.id ? result : row) || rows);
      setCadreReason('');
    }
  };
  const saveScopes = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (scopeReason.trim().length < 3) return scopeAction.setError('Give a reason of at least 3 characters.');
    if (scopeDrafts.some((scope) => SCOPE_DIMS.every((item) => scope[item.key] === null))) {
      return scopeAction.setError('Complete each scope row or remove it before saving.');
    }
    const scopes = scopeDrafts.map(({ dim: _dim, ...scope }) => ({
      region_id: scope.region_id,
      cluster_id: scope.cluster_id,
      facility_id: scope.facility_id,
      community_area_id: scope.community_area_id,
      organization_id: scope.organization_id,
    }));
    const result = await scopeAction.run(() => api.put<AdminUser>(`/admin/users/${selected.id}/scopes`, { scopes, reason: scopeReason.trim() }));
    if (result) {
      users.setData((rows) => rows?.map((row) => row.id === result.id ? result : row) || rows);
      setScopeDrafts(result.scopes.map((scope) => {
        const keys = SCOPE_DIMS.filter((item) => scope[item.key] !== null);
        return { ...scope, dim: keys.length === 1 ? keys[0].key : undefined };
      }));
      setScopeReason('');
    }
  };
  if (!hasRole(...REVIEWER_ROLES, 'SUPER_ADMIN')) return <p className="notice">This page is limited to authorized reviewer roles.</p>;
  return <div className="stack-lg">
    <header className="page-header"><div><h1>Review assignments</h1><p className="muted small">Assign eligible work-log cadres, regions and organizations. Changes are reasoned and audited.</p></div></header>
    <AsyncState data={users.data} error={users.error} loading={users.loading} empty="No reviewer or finance users are visible in your scope.">
      {() => <div className="stack-lg">
        <Field label="Reviewer or finance user">
          <select required value={userId} onChange={(event) => choose(event.target.value)}>
            <option value="">Choose user…</option>
            {reviewers.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.roles.filter((role) => REVIEWER_ROLES.includes(role)).map(roleLabel).join(', ')}</option>)}
          </select>
        </Field>
        {selected && <>
          <form className="card stack" onSubmit={saveCadres}>
            <fieldset className="stack">
              <legend>Review cadre scope</legend>
              <p className="muted small">Work-log review access is restricted to these cadres in combination with the user's region and organization scopes.</p>
              <Alert>{cadres.error}</Alert>
              {(cadres.data || []).map((cadre) => <label className="row" key={cadre.id}>
                <input type="checkbox" checked={cadreIds.includes(cadre.id)} disabled={cadreAction.busy} onChange={(event) => setCadreIds((current) => event.target.checked ? [...current, cadre.id] : current.filter((id) => id !== cadre.id))} />
                <span>{cadre.name} <span className="muted small">({cadre.code})</span></span>
              </label>)}
            </fieldset>
            <Field label="Reason for cadre assignment change (required)"><input required minLength={3} maxLength={500} value={cadreReason} onChange={(event) => setCadreReason(event.target.value)} /></Field>
            <Alert>{cadreAction.error}</Alert>
            <button className="btn btn-primary" disabled={cadreAction.busy || cadres.loading || cadreReason.trim().length < 3}>{cadreAction.busy ? 'Saving…' : 'Save review cadres'}</button>
          </form>
          <form className="card stack" onSubmit={saveScopes}>
            <fieldset className="stack">
              <legend>Region and organization scopes</legend>
              <p className="muted small">Use region and organization scopes to limit new-channel access. Other existing scope dimensions remain supported.</p>
              <Alert>{lookupsError}</Alert>
              {scopeDrafts.length === 0 && <p className="muted">No geographic or organization scope rows. Add the scopes this user should serve.</p>}
              {scopeDrafts.map((scope, index) => {
                const populated = SCOPE_DIMS.filter((item) => scope[item.key] !== null);
                const otherDimensions = populated.filter((item) => item.key !== 'region_id' && item.key !== 'organization_id');
                if (otherDimensions.length) return <div className="row-between" key={index}><span>{scopeDescription(scope)}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setScopeDrafts((items) => items.filter((_, i) => i !== index))}>Remove scope</button></div>;
                return <div className="row" key={index} style={{ alignItems: 'flex-end' }}>
                  <Field label={`Scope ${index + 1}: region`}>
                    <select value={scope.region_id === null ? '' : String(scope.region_id)} disabled={scopeAction.busy} onChange={(event) => setScopeDrafts((items) => items.map((row, i) => i === index ? { ...row, region_id: event.target.value ? Number(event.target.value) : null } : row))}>
                      <option value="">Any region</option>{lists.region_id.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </Field>
                  <Field label={`Scope ${index + 1}: organization`}>
                    <select value={scope.organization_id === null ? '' : String(scope.organization_id)} disabled={scopeAction.busy} onChange={(event) => setScopeDrafts((items) => items.map((row, i) => i === index ? { ...row, organization_id: event.target.value ? Number(event.target.value) : null } : row))}>
                      <option value="">Any organization</option>{lists.organization_id.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </Field>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScopeDrafts((items) => items.filter((_, i) => i !== index))} disabled={scopeAction.busy}>Remove</button>
                </div>;
              })}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScopeDrafts((items) => [...items, emptyScope()])} disabled={scopeAction.busy}>Add region or organization scope</button>
            </fieldset>
            <Field label="Reason for scope change (required)"><input required minLength={3} maxLength={500} value={scopeReason} onChange={(event) => setScopeReason(event.target.value)} /></Field>
            <Alert>{scopeAction.error}</Alert>
            <button className="btn btn-primary" disabled={scopeAction.busy || Boolean(lookupsError) || scopeReason.trim().length < 3}>{scopeAction.busy ? 'Saving…' : 'Save region and organization scopes'}</button>
          </form>
        </>}
      </div>}
    </AsyncState>
  </div>;
}
