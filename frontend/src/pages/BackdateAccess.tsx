import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Field } from '../components/ui';
import { useAction, useApi } from '../hooks';

type Provider = { id: number; name: string; cadre: string; region: string };
type Grant = {
  id: number;
  staff_id: number;
  provider_name: string;
  entry_date: string;
  expires_at: string;
  reason: string;
  granted_by_name: string;
  revoked_at: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
};
type AccessData = { grace_hours: number; providers: Provider[]; grants: Grant[] };

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const readableDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const readableDateTime = (value: string) => new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function BackdateAccess() {
  const { hasRole } = useAuth();
  const [entryDate, setEntryDate] = useState(today);
  const [providerId, setProviderId] = useState('');
  const [validHours, setValidHours] = useState('24');
  const [reason, setReason] = useState('');
  const [loadedDate, setLoadedDate] = useState('');
  const [datePending, setDatePending] = useState(false);
  const requestStarted = useRef(false);
  const data = useApi<AccessData>(`/backdate-access?entry_date=${encodeURIComponent(entryDate)}`);
  const grantAction = useAction();
  const revokeAction = useAction();

  useEffect(() => {
    setProviderId('');
    setLoadedDate('');
  }, [entryDate]);
  useEffect(() => {
    if (data.loading) requestStarted.current = true;
    else if (requestStarted.current) {
      requestStarted.current = false;
      setDatePending(false);
    }
  }, [data.loading]);
  useEffect(() => {
    if (!data.loading && data.data) setLoadedDate(entryDate);
  }, [data.loading, data.data, entryDate]);

  const providersReady = !data.loading && !datePending && loadedDate === entryDate;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const staffId = Number(providerId);
    if (!providersReady || data.error || !staffId || reason.trim().length < 5) return;
    const result = await grantAction.run(async () => {
      await api.post<Grant>('/backdate-access', {
        staff_id: staffId,
        entry_date: entryDate,
        valid_hours: Number(validHours),
        reason: reason.trim(),
      });
      return true;
    });
    if (result) {
      setReason('');
      await data.reload();
    }
  };
  const revoke = async (grant: Grant) => {
    if (!window.confirm(`Revoke backdated access for ${grant.provider_name} on ${readableDate(grant.entry_date)}?`)) return;
    const result = await revokeAction.run(async () => {
      await api.del<Grant>(`/backdate-access/${grant.id}`);
      return true;
    });
    if (result) await data.reload();
  };

  if (!hasRole('TECHNICAL_OFFICER', 'SUPER_ADMIN')) {
    return <p className="notice">This page is limited to Technical Officers and Super Admins.</p>;
  }

  const grants = data.data?.grants || [];
  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <p className="eyebrow">Work · Controlled exception</p>
          <h1>Backdated entry access</h1>
          <p className="muted small">Temporarily reopen a provider’s entry for a specific date. Every grant is recorded with its reason and expiry.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => data.reload()} disabled={data.loading}>
          {data.loading ? 'Refreshing…' : 'Refresh access'}
        </button>
      </header>

      <section className="notice notice-info" aria-label="Backdate access policy">
        <strong>Standard window: {data.data?.grace_hours ?? 72} hours.</strong>
        <span> This access is only for reopening date-specific missing entries. It does not unlock closed or review-locked logs.</span>
      </section>

      <div className="grid-2">
        <form className="card stack" onSubmit={submit}>
          <div>
            <h2>Grant temporary access</h2>
            <p className="muted small">Choose a date first. Providers are limited to assignments valid on that date and within your technical scope.</p>
          </div>
          <Field label="Work date">
            <input type="date" required value={entryDate} onChange={(event) => {
              requestStarted.current = false;
              setDatePending(true);
              setEntryDate(event.target.value);
            }} />
          </Field>
          <AsyncState data={data.data} error={data.error} loading={data.loading} empty="No eligible providers are assigned on this date.">
            {() => (
              <Field label="Provider">
                <select
                  required
                  value={providerId}
                  disabled={!providersReady || !data.data?.providers.length || grantAction.busy}
                  onChange={(event) => setProviderId(event.target.value)}
                >
                  <option value="">{providersReady ? 'Choose a provider…' : 'Loading date assignments…'}</option>
                  {(providersReady ? data.data?.providers || [] : []).map((provider) => (
                    <option value={provider.id} key={provider.id}>{provider.name} · {provider.cadre} · {provider.region}</option>
                  ))}
                </select>
              </Field>
            )}
          </AsyncState>
          <Field label="Access duration" hint="Choose 1 to 168 hours. The default is 24 hours.">
            <div className="row">
              <input aria-label="Access duration in hours" type="number" min="1" max="168" step="1" required value={validHours} onChange={(event) => setValidHours(event.target.value)} />
              <span className="muted">hours</span>
            </div>
          </Field>
          <Field label="Reason for access" hint="Required for the audit record; be specific about the missing entry.">
            <textarea required minLength={5} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe why this date needs to be reopened" />
          </Field>
          <Alert>{grantAction.error}</Alert>
          <button className="btn btn-primary" disabled={grantAction.busy || data.loading || !providerId || reason.trim().length < 5 || Number(validHours) < 1 || Number(validHours) > 168}>
            {grantAction.busy ? 'Granting access…' : 'Grant backdated access'}
          </button>
        </form>

        <section className="card stack" aria-labelledby="access-boundaries">
          <h2 id="access-boundaries">Access boundaries</h2>
          <div className="stack">
            <div className="row"><span className="badge badge-info">01</span><p><strong>One date at a time</strong><br /><span className="muted small">The provider can only reopen the selected missing work date.</span></p></div>
            <div className="row"><span className="badge badge-info">02</span><p><strong>Time limited</strong><br /><span className="muted small">Access expires automatically after the approved duration.</span></p></div>
            <div className="row"><span className="badge badge-info">03</span><p><strong>Existing controls remain</strong><br /><span className="muted small">Closed logs and logs locked for review cannot be reopened through this grant.</span></p></div>
          </div>
          <div className="notice">
            Review the active grants below and revoke access early when the correction is complete.
          </div>
        </section>
      </div>

      <section className="card stack" aria-labelledby="grant-list-title">
        <div className="row-between">
          <div>
            <h2 id="grant-list-title">Access grants</h2>
            <p className="muted small">Current and previous grants visible in your scope.</p>
          </div>
          <span className="badge">{grants.length} {grants.length === 1 ? 'grant' : 'grants'}</span>
        </div>
        <AsyncState data={data.data} error={data.error} loading={data.loading} empty="No backdated access grants yet.">
          {() => grants.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Provider</th><th>Work date</th><th>Expires</th><th>Reason</th><th>Granted by</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {grants.map((grant) => (
                    <tr key={grant.id}>
                      <td><strong>{grant.provider_name}</strong></td>
                      <td>{readableDate(grant.entry_date)}</td>
                      <td>{readableDateTime(grant.expires_at)}</td>
                      <td>{grant.reason}</td>
                      <td>{grant.granted_by_name}</td>
                      <td><span className={`badge ${grant.status === 'ACTIVE' ? 'badge-success' : grant.status === 'REVOKED' ? 'badge-muted' : ''}`}>{grant.status}</span></td>
                      <td>{grant.status === 'ACTIVE' && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(grant)} disabled={revokeAction.busy} aria-label={`Revoke access for ${grant.provider_name}`}>
                          Revoke
                        </button>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </AsyncState>
        <Alert>{revokeAction.error}</Alert>
      </section>
    </div>
  );
}
