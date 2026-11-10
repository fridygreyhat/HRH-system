import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Field } from '../components/ui';
import { CADRE_NAMES, cadreName, roleLabel } from '../format';
import { useAction, useApi } from '../hooks';
import { AdminUser, Cadre, Named, UserScope } from '../types';

const REVIEWER_ROLES = ['CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE'];
const CADRE_SCOPED_ROLES = ['CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE'];
type ScopeDim = 'region_id' | 'cluster_id' | 'facility_id' | 'community_area_id' | 'organization_id';
type ScopeDraft = UserScope & { dim?: ScopeDim };
const SCOPE_DIMS: { key: ScopeDim; label: string; sw: string; path: string }[] = [
  { key: 'region_id', label: 'Region', sw: 'Mkoa', path: '/admin/regions' },
  { key: 'cluster_id', label: 'Cluster', sw: 'Kundi', path: '/admin/clusters' },
  { key: 'facility_id', label: 'Facility', sw: 'Kituo', path: '/admin/facilities' },
  { key: 'community_area_id', label: 'Community area', sw: 'Eneo la jamii', path: '/admin/community-areas' },
  { key: 'organization_id', label: 'Organization', sw: 'Shirika', path: '/admin/organizations' },
];
const emptyScope = (dim: ScopeDim = 'region_id'): ScopeDraft => ({
  region_id: null, cluster_id: null, facility_id: null, community_area_id: null, organization_id: null, dim,
});

function scopeDescription(scope: ScopeDraft, sw = false): string {
  return SCOPE_DIMS.filter((item) => scope[item.key] !== null && scope[item.key] !== undefined)
    .map((item) => `${sw ? item.sw : item.label} #${scope[item.key]}`).join(' + ');
}

export function ReviewCadres() {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const t = (en: string, swText: string) => (sw ? swText : en);
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
  const canAssignCadres = Boolean(selected?.roles.some((role) => CADRE_SCOPED_ROLES.includes(role)));
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
    if (cadreReason.trim().length < 3) return cadreAction.setError(t('Give a reason of at least 3 characters.', 'Andika sababu ya angalau herufi 3.'));
    const result = await cadreAction.run(() => api.put<AdminUser>(`/admin/users/${selected.id}/review-cadres`, { cadre_ids: cadreIds, reason: cadreReason.trim() }));
    if (result) {
      users.setData((rows) => rows?.map((row) => row.id === result.id ? result : row) || rows);
      setCadreReason('');
    }
  };
  const saveScopes = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (scopeReason.trim().length < 3) return scopeAction.setError(t('Give a reason of at least 3 characters.', 'Andika sababu ya angalau herufi 3.'));
    if (scopeDrafts.some((scope) => SCOPE_DIMS.every((item) => scope[item.key] === null))) {
      return scopeAction.setError(t('Complete each scope row or remove it before saving.', 'Kamilisha kila mstari wa eneo au uuondoe kabla ya kuhifadhi.'));
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
  if (!hasRole(...REVIEWER_ROLES, 'SUPER_ADMIN')) return <p className="notice">{t('This page is limited to authorized reviewer roles.', 'Ukurasa huu ni kwa wakaguzi walioidhinishwa tu.')}</p>;
  return <div className="stack-lg">
    <header className="page-header"><div><h1>{t('Review assignments', 'Mgawo wa wakaguzi')}</h1></div></header>
    <AsyncState data={users.data} error={users.error} loading={users.loading} empty={t('No reviewer or finance users are visible in your scope.', 'Hakuna wakaguzi au watumiaji wa Fedha katika eneo lako.')}>
      {() => <div className="stack-lg">
        <Field label={t('Reviewer or finance user', 'Mkaguzi au mtumiaji wa Fedha')}>
          <select required value={userId} onChange={(event) => choose(event.target.value)}>
            <option value="">{t('Choose user…', 'Chagua mtumiaji…')}</option>
            {reviewers.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.roles.filter((role) => REVIEWER_ROLES.includes(role)).map(roleLabel).join(', ')}</option>)}
          </select>
        </Field>
        {selected && <>
          {canAssignCadres ? <form className="card stack" onSubmit={saveCadres}>
            <fieldset className="stack">
              <legend>{t('Review cadre scope', 'Kada za kukagua')}</legend>
              <p className="muted small">{t('Technical and finance review is limited to the selected cadres.', 'Mapitio ya kitaalamu na ya Fedha ni kwa kada zilizochaguliwa tu.')}</p>
              <Alert>{cadres.error}</Alert>
              {(cadres.data || []).map((cadre) => <label className="row" key={cadre.id}>
                <input type="checkbox" checked={cadreIds.includes(cadre.id)} disabled={cadreAction.busy} onChange={(event) => setCadreIds((current) => event.target.checked ? [...current, cadre.id] : current.filter((id) => id !== cadre.id))} />
                <span>{CADRE_NAMES[cadre.code] ? cadreName(cadre.code, lang) : cadre.name} <span className="muted small">({cadre.code})</span></span>
              </label>)}
            </fieldset>
            <Field label={t('Reason for cadre assignment change (required)', 'Sababu ya kubadilisha kada (lazima)')}><input required minLength={3} maxLength={500} value={cadreReason} onChange={(event) => setCadreReason(event.target.value)} /></Field>
            <Alert>{cadreAction.error}</Alert>
            <button className="btn btn-primary" disabled={cadreAction.busy || cadres.loading || cadreReason.trim().length < 3}>{cadreAction.busy ? t('Saving…', 'Inahifadhi…') : t('Save review cadres', 'Hifadhi kada za kukagua')}</button>
          </form> : selected?.roles.includes('RPM') ? <p className="notice notice-info">{t('RM approval covers every cadre in the assigned regions.', 'Idhini ya RM inahusu kada zote katika mikoa aliyopangiwa.')}</p> : null}
          <form className="card stack" onSubmit={saveScopes}>
            <fieldset className="stack">
              <legend>{t('Region and organization scopes', 'Mikoa na mashirika')}</legend>
              <Alert>{lookupsError}</Alert>
              {scopeDrafts.length === 0 && <p className="muted">{t('No scope rows yet.', 'Bado hakuna maeneo.')}</p>}
              {scopeDrafts.map((scope, index) => {
                const populated = SCOPE_DIMS.filter((item) => scope[item.key] !== null);
                const otherDimensions = populated.filter((item) => item.key !== 'region_id' && item.key !== 'organization_id');
                if (otherDimensions.length) return <div className="row-between" key={index}><span>{scopeDescription(scope, sw)}</span><button type="button" className="btn btn-ghost btn-sm" onClick={() => setScopeDrafts((items) => items.filter((_, i) => i !== index))}>{t('Remove scope', 'Ondoa eneo')}</button></div>;
                return <div className="row" key={index} style={{ alignItems: 'flex-end' }}>
                  <Field label={sw ? `Eneo ${index + 1}: mkoa` : `Scope ${index + 1}: region`}>
                    <select value={scope.region_id === null ? '' : String(scope.region_id)} disabled={scopeAction.busy} onChange={(event) => setScopeDrafts((items) => items.map((row, i) => i === index ? { ...row, region_id: event.target.value ? Number(event.target.value) : null } : row))}>
                      <option value="">{t('Any region', 'Mkoa wowote')}</option>{lists.region_id.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </Field>
                  <Field label={sw ? `Eneo ${index + 1}: shirika` : `Scope ${index + 1}: organization`}>
                    <select value={scope.organization_id === null ? '' : String(scope.organization_id)} disabled={scopeAction.busy} onChange={(event) => setScopeDrafts((items) => items.map((row, i) => i === index ? { ...row, organization_id: event.target.value ? Number(event.target.value) : null } : row))}>
                      <option value="">{t('Any organization', 'Shirika lolote')}</option>{lists.organization_id.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </Field>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScopeDrafts((items) => items.filter((_, i) => i !== index))} disabled={scopeAction.busy}>{t('Remove', 'Ondoa')}</button>
                </div>;
              })}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScopeDrafts((items) => [...items, emptyScope()])} disabled={scopeAction.busy}>{t('Add region or organization scope', 'Ongeza mkoa au shirika')}</button>
            </fieldset>
            <Field label={t('Reason for scope change (required)', 'Sababu ya kubadilisha maeneo (lazima)')}><input required minLength={3} maxLength={500} value={scopeReason} onChange={(event) => setScopeReason(event.target.value)} /></Field>
            <Alert>{scopeAction.error}</Alert>
            <button className="btn btn-primary" disabled={scopeAction.busy || Boolean(lookupsError) || scopeReason.trim().length < 3}>{scopeAction.busy ? t('Saving…', 'Inahifadhi…') : t('Save region and organization scopes', 'Hifadhi mikoa na mashirika')}</button>
          </form>
        </>}
      </div>}
    </AsyncState>
  </div>;
}
