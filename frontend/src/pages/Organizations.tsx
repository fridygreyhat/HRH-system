import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { num } from '../format';
import { useAction, useApi } from '../hooks';
import { OrganizationAssignment, OrganizationsResponse } from '../types';
import { Alert, AsyncState, Field, KpiStrip, Modal, StatusBadge, pageLang } from '../components/ui';
import './organizations.css';
import './polish-admin.css';

const TYPE_NAMES: Record<string, { en: string; sw: string }> = {
  CSO: { en: 'CSO', sw: 'CSO' },
  PARTNER: { en: 'Partner', sw: 'Mshirika' },
  FHI360: { en: 'FHI360', sw: 'FHI360' },
  PAYOR: { en: 'Payor', sw: 'Mlipaji' },
};
const typeName = (type: string, sw: boolean) => TYPE_NAMES[type]?.[sw ? 'sw' : 'en'] || type;
const activeBadge = (active: boolean, sw: boolean) => (
  <StatusBadge status={active ? 'ACTIVE' : 'INACTIVE'} label={sw ? (active ? 'Hai' : 'Haitumiki') : undefined} />
);

function OrganizationForm({ regions, onClose, onSaved }: { regions: OrganizationsResponse['regions']; onClose: () => void; onSaved: () => void }) {
  const sw = pageLang() === 'sw';
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<'CSO' | 'PARTNER'>('CSO');
  const [regionIds, setRegionIds] = useState<number[]>([]);
  const { busy, error, run } = useAction();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (type === 'CSO' && regionIds.length === 0) return;
    const saved = await run(() => api.post('/organizations/create-org', {
      name: name.trim(), code: code.trim() || null, type, is_active: true,
      region_ids: type === 'CSO' ? regionIds : [],
    }));
    if (saved) onSaved();
  };
  const toggleRegion = (id: number) => setRegionIds((current) => current.includes(id) ? current.filter((regionId) => regionId !== id) : [...current, id]);
  return (
    <Modal title={sw ? 'Ongeza shirika' : 'Add an organization'} onClose={onClose}>
      <form className="stack org-create-form" onSubmit={submit}>
        <p className="muted small">{sw ? 'Mashirika hayawezi kufutwa.' : 'Organizations cannot be deleted.'}</p>
        <Field label={sw ? 'Jina la shirika' : 'Organization name'}><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} /></Field>
        <Field label={sw ? 'Msimbo' : 'Code'} hint={sw ? 'Si lazima' : 'Optional'}><input value={code} onChange={(e) => setCode(e.target.value)} maxLength={50} /></Field>
        <Field label={sw ? 'Aina ya shirika' : 'Organization type'}>
          <select value={type} onChange={(e) => { setType(e.target.value as 'CSO' | 'PARTNER'); setRegionIds([]); }}>
            <option value="CSO">CSO</option><option value="PARTNER">{typeName('PARTNER', sw)}</option>
          </select>
        </Field>
        {type === 'CSO' ? (
          <fieldset className="org-region-picker">
            <legend>{sw ? 'Mikoa ambayo CSO hii inaweza kufanya kazi' : 'Regions this CSO may work in'} <span>{sw ? 'Lazima · chagua mmoja au zaidi' : 'Required · choose one or more'}</span></legend>
            {regions.length ? <div className="org-region-options">
              {regions.map((region) => <label className="org-region-option" key={region.id}>
                <input type="checkbox" checked={regionIds.includes(region.id)} onChange={() => toggleRegion(region.id)} />
                <span>{region.name}</span>
              </label>)}
            </div> : <div className="org-region-empty">{sw ? 'Hakuna mikoa. CSO inahitaji angalau mkoa mmoja.' : 'No regions available. A CSO needs at least one region.'}</div>}
          </fieldset>
        ) : (
          <div className="org-partner-note">
            <strong>{sw ? 'Mashirika washirika hayapewi mamlaka ya malipo ya mkoa.' : 'Partner organizations do not receive regional payment authority.'}</strong>
            <span>{sw ? 'Hakuna mkoa utakaounganishwa.' : 'No regions will be linked.'}</span>
          </div>
        )}
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !name.trim() || (type === 'CSO' && regionIds.length === 0)}>
            {busy ? (sw ? 'Inaunda…' : 'Creating…') : sw ? 'Unda shirika' : 'Create organization'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{sw ? 'Ghairi' : 'Cancel'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Organizations() {
  const sw = pageLang() === 'sw';
  const metadata = useApi<OrganizationsResponse>('/organizations');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const data = metadata.data;
  const orgs = data?.organizations || [];
  const assignedPairs = useMemo(() => new Set((data?.assignments || []).map((item) => `${item.organization_id}:${item.region_id}`)), [data?.assignments]);
  const activeAssignedPairs = useMemo(() => new Set((data?.assignments || []).filter((item) => item.is_active).map((item) => `${item.organization_id}:${item.region_id}`)), [data?.assignments]);

  const refresh = async (message: string) => {
    setNotice(message);
    setCreatingOrg(false);
    await metadata.reload();
  };

  const addAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(() => api.post('/organizations/assign-cso-region', {
      organization_id: Number(selectedOrg), region_id: Number(selectedRegion), is_active: true,
    }));
    if (result) {
      setSelectedRegion('');
      await refresh(sw ? 'Kiungo cha mkoa kimeongezwa.' : 'Regional assignment added.');
    }
  };

  const toggleAssignment = async (assignment: OrganizationAssignment) => {
    const pair = `${assignment.organization_name} · ${assignment.region_name}`;
    const question = sw
      ? `Zima ${pair}?\n\nHii inazuia upelekaji wa mishahara na shughuli za bajeti za CSO hii katika mkoa huu kuanzia sasa. Historia iliyopo inabaki.`
      : `Deactivate ${pair}?\n\nThis blocks future payroll routing and budget operations for this CSO-region. Existing history is preserved.`;
    if (assignment.is_active && !window.confirm(question)) return;
    const result = await run(() => api.post('/organizations/assign-cso-region', {
      organization_id: assignment.organization_id, region_id: assignment.region_id, is_active: !assignment.is_active,
    }));
    if (result) await refresh(sw ? `${pair} sasa ${assignment.is_active ? 'imezimwa' : 'iko hai'}.` : `${pair} is now ${assignment.is_active ? 'inactive' : 'active'}.`);
  };

  return (
    <div className="stack-lg org-page">
      <header className="page-header">
        <h1>Organizations &amp; CSO regions</h1>
        {data?.can_manage && <button type="button" className="btn btn-primary" onClick={() => setCreatingOrg(true)}>{sw ? 'Ongeza shirika' : 'Add organization'}</button>}
      </header>
      <Alert kind="success">{notice}</Alert>
      <Alert>{error}</Alert>
      {metadata.error && <button type="button" className="btn btn-secondary btn-sm" onClick={metadata.reload}>{sw ? 'Jaribu tena' : 'Retry organization data'}</button>}
      <AsyncState data={data} error={metadata.error} loading={metadata.loading} empty={sw ? 'Akaunti hii haina mashirika ya kuona.' : 'No organization scope is available for this account.'}>
        {(result) => {
          const activeLinks = result.assignments.filter((a) => a.is_active);
          const activeCsos = result.organizations.filter((o) => o.type === 'CSO' && o.is_active).length;
          const coveredRegions = new Set(activeLinks.map((a) => a.region_id)).size;
          return (
            <>
              <KpiStrip
                label={sw ? 'Muhtasari wa mashirika' : 'Organization summary'}
                items={[
                  { icon: 'layers', label: sw ? 'Mashirika' : 'Organizations', value: num(result.organizations.length) },
                  { icon: 'users', tone: 'info', label: sw ? 'CSO hai' : 'Active CSOs', value: num(activeCsos) },
                  { icon: 'route', tone: 'success', label: sw ? 'Viungo hai vya mikoa' : 'Active region links', value: num(activeLinks.length) },
                  {
                    icon: 'globe',
                    tone: coveredRegions < result.regions.length ? 'warn' : 'success',
                    label: sw ? 'Mikoa yenye CSO' : 'Regions with a CSO',
                    value: `${num(coveredRegions)} / ${num(result.regions.length)}`,
                  },
                ]}
              />
              <div className="org-layout">
                <section className="card org-panel">
                  <div className="row-between">
                    <h2>{sw ? 'Mashirika' : 'Organizations'}</h2>
                    <span className="muted small">{sw ? `${result.organizations.length} yanaonekana` : `${result.organizations.length} visible`}</span>
                  </div>
                  {result.organizations.length ? <div className="org-directory">
                    {result.organizations.map((org) => <article className="org-directory-row" key={org.id}>
                      <span className="org-monogram">{org.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                      <div className="org-directory-copy"><strong>{org.name}</strong><small>{org.code || (sw ? 'Hakuna msimbo' : 'No code')} · {typeName(org.type, sw)}</small></div>
                      {activeBadge(org.is_active, sw)}
                    </article>)}
                  </div> : <div className="org-empty"><strong>{sw ? 'Hakuna mashirika' : 'No organizations in scope'}</strong></div>}
                </section>
                <section className="card org-panel">
                  <div className="row-between">
                    <h2>{sw ? 'Viungo vya CSO na mikoa' : 'CSO region links'}</h2>
                    <span className="org-lock">{sw ? `Viungo hai: ${activeLinks.length}` : `Active links: ${activeLinks.length}`}</span>
                  </div>
                  {result.can_manage && <form className="org-assign-form" onSubmit={addAssignment}>
                    <Field label="CSO"><select value={selectedOrg} onChange={(e) => { setSelectedOrg(e.target.value); setSelectedRegion(''); }} required>
                      <option value="">{sw ? 'Chagua CSO hai…' : 'Choose active CSO…'}</option>{orgs.filter((o) => o.type === 'CSO' && o.is_active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select></Field>
                    <Field label={sw ? 'Mkoa' : 'Region'}><select value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)} required>
                      <option value="">{sw ? 'Chagua mkoa…' : 'Choose region…'}</option>{result.regions.filter((r) => !activeAssignedPairs.has(`${selectedOrg}:${r.id}`)).map((r) => <option key={r.id} value={r.id}>{r.name}{assignedPairs.has(`${selectedOrg}:${r.id}`) ? (sw ? ' · kiungo kisichotumika' : ' · inactive link') : ''}</option>)}
                    </select></Field>
                    <button className="btn btn-secondary" disabled={busy || !selectedOrg || !selectedRegion}>{sw ? 'Ongeza kiungo' : 'Add region link'}</button>
                  </form>}
                  {result.assignments.length ? <div className="table-wrap"><table><thead><tr><th>{sw ? 'Shirika' : 'Organization'}</th><th>{sw ? 'Mkoa' : 'Region'}</th><th>{sw ? 'Hali' : 'Status'}</th>{result.can_manage && <th>{sw ? 'Hatua' : 'Action'}</th>}</tr></thead>
                    <tbody>{result.assignments.map((assignment) => {
                      const orgIsAssignable = result.organizations.some((org) => org.id === assignment.organization_id && org.type === 'CSO' && org.is_active);
                      return <tr key={assignment.id}><td><strong>{assignment.organization_name}</strong></td><td>{assignment.region_name}</td><td>{activeBadge(assignment.is_active, sw)}</td>
                        {result.can_manage && <td><button type="button" className="btn btn-secondary btn-sm" disabled={busy || !orgIsAssignable} title={!orgIsAssignable ? (sw ? 'CSO hai pekee zinaweza kupangiwa.' : 'Only active CSOs can be assigned.') : undefined} onClick={() => toggleAssignment(assignment)}>{assignment.is_active ? (sw ? 'Zima' : 'Deactivate') : sw ? 'Washa tena' : 'Reactivate'}</button></td>}</tr>;
                    })}</tbody></table></div>
                    : <div className="org-empty org-empty-mapping"><div className="org-empty-symbol" aria-hidden="true">+</div><strong>{sw ? 'Bado hakuna viungo vya CSO na mikoa' : 'No CSO region links yet'}</strong>{result.can_manage && <p>{sw ? 'Chagua CSO hai na mkoa hapo juu.' : 'Choose an active CSO and region above.'}</p>}</div>}
                </section>
              </div>
            </>
          );
        }}
      </AsyncState>
      {data?.can_manage && creatingOrg && <OrganizationForm regions={data.regions} onClose={() => setCreatingOrg(false)} onSaved={() => refresh(sw ? 'Shirika limeundwa.' : 'Organization created.')} />}
    </div>
  );
}
