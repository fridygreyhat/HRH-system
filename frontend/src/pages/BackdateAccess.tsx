import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Field, KpiStrip, PersonCell } from '../components/ui';
import { num } from '../format';
import './polish-review.css';
import { useAction, useApi } from '../hooks';

type Provider = { id: number; name: string; cadre: string; region: string };
type Grant = {
  id: number;
  staff_id: number;
  provider_name: string;
  entry_date: string;
  /** Last date covered; equals entry_date for a single day. */
  end_date?: string;
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

const STATUS_SW: Record<Grant['status'], string> = { ACTIVE: 'Inatumika', EXPIRED: 'Muda umeisha', REVOKED: 'Imefutwa' };
const STATUS_EN: Record<Grant['status'], string> = { ACTIVE: 'Active', EXPIRED: 'Expired', REVOKED: 'Revoked' };

const readableDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
/** "3 Oct 2026", or "1 Oct 2026 – 7 Oct 2026" for a range. */
const readableRange = (grant: Pick<Grant, 'entry_date' | 'end_date'>) =>
  grant.end_date && grant.end_date !== grant.entry_date ? `${readableDate(grant.entry_date)} – ${readableDate(grant.end_date)}` : readableDate(grant.entry_date);
const MAX_RANGE_DAYS = 31;
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000) + 1;
const readableDateTime = (value: string) => new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function BackdateAccess() {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const t = (en: string, swText: string) => (sw ? swText : en);
  const [entryDate, setEntryDate] = useState(today);
  const [endDate, setEndDate] = useState('');
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
    setEndDate((current) => (current && current < entryDate ? '' : current));
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
  const rangeDays = endDate ? daysBetween(entryDate, endDate) : 1;
  const rangeError = endDate && endDate < entryDate
    ? t('The end date must be on or after the start date.', 'Tarehe ya mwisho iwe sawa au baada ya tarehe ya kuanzia.')
    : rangeDays > MAX_RANGE_DAYS ? t(`A range may cover at most ${MAX_RANGE_DAYS} days.`, `Kipindi kisizidi siku ${MAX_RANGE_DAYS}.`) : '';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const staffId = Number(providerId);
    if (!providersReady || data.error || !staffId || reason.trim().length < 5 || rangeError) return;
    const result = await grantAction.run(async () => {
      await api.post<Grant>('/backdate-access', {
        staff_id: staffId,
        entry_date: entryDate,
        end_date: endDate && endDate !== entryDate ? endDate : null,
        valid_hours: Number(validHours),
        reason: reason.trim(),
      });
      return true;
    });
    if (result) {
      setReason('');
      setEndDate('');
      await data.reload();
    }
  };
  const revoke = async (grant: Grant) => {
    if (!window.confirm(sw ? `Futa ruhusa ya kuingiza kwa nyuma kwa ${grant.provider_name} tarehe ${readableRange(grant)}?` : `Revoke backdated access for ${grant.provider_name} for ${readableRange(grant)}?`)) return;
    const result = await revokeAction.run(async () => {
      await api.del<Grant>(`/backdate-access/${grant.id}`);
      return true;
    });
    if (result) await data.reload();
  };

  if (!hasRole('TECHNICAL_OFFICER', 'SUPER_ADMIN')) {
    return <p className="notice">{t('This page is limited to Technical Officers and Super Admins.', 'Ukurasa huu ni kwa Maafisa wa Kitaalamu na Super Admin tu.')}</p>;
  }

  const grants = data.data?.grants || [];
  const activeCount = grants.filter((grant) => grant.status === 'ACTIVE').length;
  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <h1>{t('Backdated entry access', 'Ruhusa ya kuingiza kwa nyuma')}</h1>
          <p className="muted small">{t('Reopen missed dates for one provider: one date or a range.', 'Fungua tarehe zilizokosekana kwa mtoa huduma mmoja: tarehe moja au kipindi.')}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => data.reload()} disabled={data.loading}>
          {data.loading ? t('Refreshing…', 'Inapakia upya…') : t('Refresh access', 'Pakia upya')}
        </button>
      </header>

      <KpiStrip label={t('Backdate access numbers', 'Takwimu za ruhusa')} items={[
        { label: t('Active grants', 'Ruhusa zinazotumika'), value: data.data ? num(activeCount) : '—', icon: 'shield', tone: activeCount ? 'info' : 'neutral' },
        { label: t('Expired or revoked', 'Zilizoisha au kufutwa'), value: data.data ? num(grants.length - activeCount) : '—', icon: 'clock', tone: 'neutral' },
        { label: t('Standard entry window', 'Muda wa kawaida wa kuingiza'), value: `${data.data?.grace_hours ?? 72} ${t('h', 'saa')}`, icon: 'calendar', tone: 'neutral' },
      ]} />

      <form className="card stack" onSubmit={submit}>
        <div className="section-title">
          <h2>{t('Grant temporary access', 'Toa ruhusa ya muda')}</h2>
          <span>{t('Leave “To date” empty for one date.', 'Acha “Hadi tarehe” wazi kwa tarehe moja.')}</span>
        </div>
        <div className="backdate-grid">
          <Field label={t('From date', 'Kuanzia tarehe')}>
            <input type="date" required max={today()} value={entryDate} onChange={(event) => {
              requestStarted.current = false;
              setDatePending(true);
              setEntryDate(event.target.value);
            }} />
          </Field>
          <Field label={t('To date (optional)', 'Hadi tarehe (si lazima)')} hint={endDate && !rangeError ? (sw ? `Siku ${rangeDays}` : `${rangeDays} days`) : undefined}>
            <input type="date" aria-label="To date" min={entryDate} max={today()} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
          <AsyncState data={data.data} error={data.error} loading={data.loading} isEmpty={(value) => !value.providers?.length} empty={t('No eligible providers are assigned on this date.', 'Hakuna watoa huduma waliopangwa tarehe hii.')}>
            {() => (
              <Field label={t('Provider', 'Mtoa huduma')}>
                <select
                  required
                  value={providerId}
                  disabled={!providersReady || !data.data?.providers.length || grantAction.busy}
                  onChange={(event) => setProviderId(event.target.value)}
                >
                  <option value="">{providersReady ? t('Choose a provider…', 'Chagua mtoa huduma…') : t('Loading date assignments…', 'Inapakia waliopangwa tarehe hii…')}</option>
                  {(providersReady ? data.data?.providers || [] : []).map((provider) => (
                    <option value={provider.id} key={provider.id}>{provider.name} · {provider.cadre} · {provider.region}</option>
                  ))}
                </select>
              </Field>
            )}
          </AsyncState>
          <Field label={t('Access duration', 'Muda wa ruhusa')} hint={t('1 to 168 hours.', 'Saa 1 hadi 168.')}>
            <div className="row">
              <input aria-label="Access duration in hours" type="number" min="1" max="168" step="1" required value={validHours} onChange={(event) => setValidHours(event.target.value)} />
              <span className="muted">{t('hours', 'saa')}</span>
            </div>
          </Field>
        </div>
        <Field label={t('Reason for access', 'Sababu ya ruhusa')} hint={t('At least 5 characters.', 'Angalau herufi 5.')}>
          <textarea required minLength={5} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('Describe why this date needs to be reopened', 'Eleza kwa nini tarehe hii ifunguliwe tena')} />
        </Field>
        {rangeError && <Alert kind="warn">{rangeError}</Alert>}
        <Alert>{grantAction.error}</Alert>
        <div>
          <button className="btn btn-primary" disabled={grantAction.busy || data.loading || !providerId || !!rangeError || reason.trim().length < 5 || Number(validHours) < 1 || Number(validHours) > 168}>
            {grantAction.busy ? t('Granting access…', 'Inatoa ruhusa…') : t('Grant backdated access', 'Toa ruhusa ya kuingiza kwa nyuma')}
          </button>
        </div>
      </form>

      <section className="stack" aria-labelledby="grant-list-title">
        <div className="section-title">
          <h2 id="grant-list-title">{t('Access grants', 'Ruhusa zilizotolewa')}</h2>
          <span>{sw ? `Ruhusa ${grants.length}` : `${grants.length} ${grants.length === 1 ? 'grant' : 'grants'}`}</span>
        </div>
        <AsyncState data={data.data} error={data.error} loading={data.loading} isEmpty={() => grants.length === 0} empty={t('No backdated access grants yet.', 'Bado hakuna ruhusa zilizotolewa.')}>
          {() => grants.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>{t('Provider', 'Mtoa huduma')}</th><th>{t('Work dates', 'Tarehe za kazi')}</th><th>{t('Expires', 'Inaisha')}</th><th>{t('Reason', 'Sababu')}</th>
                  <th>{t('Status', 'Hali')}</th><th><span className="sr-only">{t('Actions', 'Vitendo')}</span></th>
                </tr></thead>
                <tbody>
                  {grants.map((grant) => (
                    <tr key={grant.id}>
                      <td><PersonCell name={grant.provider_name} sub={`${t('Granted by', 'Imetolewa na')} ${grant.granted_by_name}`} /></td>
                      <td className="nowrap">{readableRange(grant)}</td>
                      <td className="nowrap">{readableDateTime(grant.expires_at)}</td>
                      <td>{grant.reason}</td>
                      <td><span className={`badge ${grant.status === 'ACTIVE' ? 'badge-success' : grant.status === 'REVOKED' ? 'badge-muted' : 'badge-neutral'}`}>{sw ? STATUS_SW[grant.status] : STATUS_EN[grant.status]}</span></td>
                      <td className="num">{grant.status === 'ACTIVE' && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(grant)} disabled={revokeAction.busy} aria-label={`Revoke access for ${grant.provider_name}`}>
                          {t('Revoke', 'Futa')}
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
