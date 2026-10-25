import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { useAction, useApi } from '../hooks';
import { OrganizationAssignment, OrganizationsResponse } from '../types';
import { Alert, AsyncState, Field, Modal, StatusBadge } from '../components/ui';
import './organizations.css';

function OrganizationForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<'CSO' | 'PARTNER'>('CSO');
  const { busy, error, run } = useAction();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await run(() => api.post('/organizations/create-org', {
      name: name.trim(), code: code.trim() || null, type, is_active: true,
    }));
    if (saved) onSaved();
  };
  return (
    <Modal title="Add an organization" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">Create a CSO or partner record. Organizations are retained for audit; they cannot be deleted.</p>
        <Field label="Organization name"><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} /></Field>
        <Field label="Code" hint="Optional internal identifier."><input value={code} onChange={(e) => setCode(e.target.value)} maxLength={50} /></Field>
        <Field label="Organization type">
          <select value={type} onChange={(e) => setType(e.target.value as 'CSO' | 'PARTNER')}>
            <option value="CSO">CSO</option><option value="PARTNER">Partner</option>
          </select>
        </Field>
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create organization'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export function Organizations() {
  const metadata = useApi<OrganizationsResponse>('/organizations');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const data = metadata.data;
  const orgs = data?.organizations || [];
  const assignedPairs = useMemo(() => new Set((data?.assignments || []).map((item) => `${item.organization_id}:${item.region_id}`)), [data?.assignments]);

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
      await refresh('Regional assignment added.');
    }
  };

  const toggleAssignment = async (assignment: OrganizationAssignment) => {
    if (assignment.is_active && !window.confirm(`Deactivate ${assignment.organization_name} · ${assignment.region_name}?\n\nThis blocks future payroll routing and budget operations for this CSO-region. Existing history is preserved.`)) return;
    const result = await run(() => api.post('/organizations/assign-cso-region', {
      organization_id: assignment.organization_id, region_id: assignment.region_id, is_active: !assignment.is_active,
    }));
    if (result) await refresh(`${assignment.organization_name} · ${assignment.region_name} is now ${assignment.is_active ? 'inactive' : 'active'}.`);
  };

  return (
    <div className="stack-lg org-page">
      <header className="page-header">
        <div><p className="org-eyebrow">Governance / Finance setup</p><h1>Organizations &amp; CSO regions</h1>
          <p className="muted">A payment route is only accountable when its organization and region are explicitly linked.</p></div>
        {data?.can_manage && <button type="button" className="btn btn-primary" onClick={() => setCreatingOrg(true)}>Add organization</button>}
      </header>
      <section className="org-summary">
        <div className="org-summary-mark" aria-hidden="true">HRH</div>
        <div><strong>One clear funding path</strong><p>CSO-region mappings determine which regional allocation can fund approved work logs. No mapping is assumed.</p></div>
        <div className="org-summary-count"><span>{data?.assignments.filter((a) => a.is_active).length ?? '—'}</span><small>active links</small></div>
      </section>
      <Alert kind="success">{notice}</Alert>
      <Alert>{error}</Alert>
      {metadata.error && <button type="button" className="btn btn-secondary btn-sm" onClick={metadata.reload}>Retry organization data</button>}
      <AsyncState data={data} error={metadata.error} loading={metadata.loading} empty="No organization scope is available for this account.">
        {(result) => (
          <div className="org-layout">
            <section className="card org-panel">
              <div className="row-between"><div><p className="org-eyebrow">Directory</p><h2>Organizations</h2></div><span className="muted small">{result.organizations.length} visible</span></div>
              {result.organizations.length ? <div className="org-directory">
                {result.organizations.map((org) => <article className="org-directory-row" key={org.id}>
                  <span className="org-monogram">{org.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                  <div className="org-directory-copy"><strong>{org.name}</strong><small>{org.code || 'No code'} · {org.type}</small></div>
                  <StatusBadge status={org.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </article>)}
              </div> : <div className="org-empty"><strong>No organizations in scope</strong><p>Organizations will appear here when they are available to your role.</p></div>}
            </section>
            <section className="card org-panel">
              <div className="row-between"><div><p className="org-eyebrow">Explicit configuration</p><h2>Regional assignments</h2></div><span className="org-lock">No inferred links</span></div>
              {result.can_manage && <form className="org-assign-form" onSubmit={addAssignment}>
                <Field label="Organization"><select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)} required>
                  <option value="">Choose active CSO…</option>{orgs.filter((o) => o.type === 'CSO' && o.is_active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select></Field>
                <Field label="Region"><select value={selectedRegion} onChange={(e) => setSelectedRegion(e.target.value)} required>
                  <option value="">Choose region…</option>{result.regions.filter((r) => !assignedPairs.has(`${selectedOrg}:${r.id}`)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select></Field>
                <button className="btn btn-secondary" disabled={busy || !selectedOrg || !selectedRegion}>Assign region</button>
              </form>}
              {result.assignments.length ? <div className="table-wrap"><table><thead><tr><th>Organization</th><th>Region</th><th>Status</th>{result.can_manage && <th>Action</th>}</tr></thead>
                <tbody>{result.assignments.map((assignment) => {
                  const orgIsAssignable = result.organizations.some((org) => org.id === assignment.organization_id && org.type === 'CSO' && org.is_active);
                  return <tr key={assignment.id}><td><strong>{assignment.organization_name}</strong></td><td>{assignment.region_name}</td><td><StatusBadge status={assignment.is_active ? 'ACTIVE' : 'INACTIVE'} /></td>
                    {result.can_manage && <td><button type="button" className="btn btn-secondary btn-sm" disabled={busy || !orgIsAssignable} title={!orgIsAssignable ? 'Only active CSOs can be assigned.' : undefined} onClick={() => toggleAssignment(assignment)}>{assignment.is_active ? 'Deactivate' : 'Reactivate'}</button></td>}</tr>;
                })}</tbody></table></div>
                : <div className="org-empty org-empty-mapping"><div className="org-empty-symbol" aria-hidden="true">—</div><strong>No regional assignments configured</strong><p>Until a link is explicitly added, a CSO has no regional budget authority.</p></div>}
              <p className="muted small org-footnote">Deactivating a link blocks future payroll routing and budget operations for that CSO-region; existing history is preserved. Assignments can be reactivated, but not deleted.</p>
            </section>
          </div>
        )}
      </AsyncState>
      {data?.can_manage && creatingOrg && <OrganizationForm onClose={() => setCreatingOrg(false)} onSaved={() => refresh('Organization created.')} />}
    </div>
  );
}
