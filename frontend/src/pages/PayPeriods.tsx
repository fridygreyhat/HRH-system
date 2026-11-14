import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { dateOnly } from '../format';
import { useAction, useApi } from '../hooks';
import { Named, PayPeriod } from '../types';
import { Alert, Field, Modal, StatusBadge } from '../components/ui';
import { ProviderPeriodRecords } from './ProviderPeriodRecords';
import { confirmAction } from '../components/ConfirmDialog';

interface PayPeriodPayload {
  start_date: string;
  end_date: string;
  period_label: string;
  status: string;
  region_id: number | null;
}

function PayPeriodForm({
  period,
  regions,
  technicalOnly,
  onClose,
  onSaved,
}: {
  period: PayPeriod | null;
  regions: Named[];
  technicalOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const [startDate, setStartDate] = useState(period?.start_date || '');
  const [endDate, setEndDate] = useState(period?.end_date || '');
  const [label, setLabel] = useState(period?.period_label || '');
  const [status, setStatus] = useState(period?.status || 'OPEN');
  const [regionId, setRegionId] = useState(period ? (period.region_id == null ? 'global' : String(period.region_id)) : '');
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const datesLocked = period?.can_edit_dates === false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (endDate < startDate) {
      setFormError(sw ? 'Tarehe ya mwisho lazima iwe siku ileile au baada ya tarehe ya kuanza.' : 'The end date must be on or after the start date.');
      return;
    }
    if (!regionId) {
      setFormError(technicalOnly ? (sw ? 'Chagua mmoja wa mikoa uliyopangiwa.' : 'Choose one of your assigned regions.') : (sw ? 'Chagua mkoa au ratiba ya jumla.' : 'Choose a region or the global schedule.'));
      return;
    }
    const body: PayPeriodPayload = {
      start_date: startDate,
      end_date: endDate,
      period_label: label.trim(),
      status,
      region_id: regionId === 'global' ? null : Number(regionId),
    };
    const saved = await run(async () => {
      if (period) await api.put(`/admin/pay-periods/${period.id}`, body);
      else await api.post('/admin/pay-periods', body);
      return true;
    });
    if (saved) onSaved();
  };

  return (
    <Modal title={period ? (sw ? 'Hariri kipindi cha malipo' : 'Edit pay period') : (sw ? 'Weka kipindi cha malipo' : 'Set up pay period')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">{sw ? 'Miezi ya malipo ni tarehe 26 hadi 25 na hufunguka yenyewe. Ongeza kipindi tu kwa tarehe maalum za mkoa.' : 'Pay months run 26th to 25th and open automatically. Add one only for regional dates.'}</p>
        {datesLocked && <Alert kind="info">{period?.date_lock_reason || (sw ? 'Kumbukumbu, madai au bajeti zilizowasilishwa zimefunga tarehe hizi.' : 'Submitted records, claims or budgets lock these dates.')}</Alert>}
        <div className="grid-2">
          <Field label={sw ? 'Tarehe ya kuanza' : 'Start date'}>
            <input type="date" required disabled={datesLocked} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label={sw ? 'Tarehe ya mwisho' : 'End date'}>
            <input type="date" required disabled={datesLocked} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
        </div>
        <Field label={sw ? 'Jina la kipindi' : 'Period label'}>
          <input required maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={sw ? 'mf. Oktoba 2026' : 'e.g. October 2026'} />
        </Field>
        <Field label={sw ? 'Mkoa' : 'Region'} hint={technicalOnly ? (sw ? 'Mikoa uliyopangiwa tu.' : 'Only your assigned regions.') : undefined}>
          <select required value={regionId} disabled={!!period} onChange={(event) => setRegionId(event.target.value)}>
            <option value="">{sw ? 'Chagua mkoa…' : 'Choose a region…'}</option>
            {!technicalOnly && <option value="global">{sw ? 'Ratiba ya jumla' : 'Global schedule'}</option>}
            {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </Field>
        <Field label={sw ? 'Hali' : 'Status'}>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="OPEN">{sw ? 'Wazi kwa kumbukumbu za kazi' : 'Open for work logs'}</option>
            <option value="CLOSED">{sw ? 'Kimefungwa' : 'Closed'}</option>
          </select>
        </Field>
        <Alert>{formError || error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !startDate || !endDate || !label.trim() || !regionId}>
            {busy ? (sw ? 'Inahifadhi…' : 'Saving…') : period ? (sw ? 'Hifadhi mabadiliko' : 'Save changes') : (sw ? 'Unda kipindi cha malipo' : 'Create pay period')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{sw ? 'Ghairi' : 'Cancel'}</button>
        </div>
      </form>
    </Modal>
  );
}

export function PayPeriods() {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const [showArchived, setShowArchived] = useState(false);
  const periods = useApi<PayPeriod[]>(`/admin/pay-periods${showArchived ? '?include_archived=true' : ''}`);
  const regions = useApi<Named[]>('/admin/pay-period-regions');
  const [editing, setEditing] = useState<PayPeriod | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const deletion = useAction();
  const [archiving, setArchiving] = useState<PayPeriod | null>(null);
  const [recordsPeriod, setRecordsPeriod] = useState<PayPeriod | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [archiveConfirmation, setArchiveConfirmation] = useState('');
  const archivePeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!archiving) return;
    const result = await deletion.run(() => api.post(`/admin/pay-periods/${archiving.id}/archive`, {
      reason: archiveReason.trim(), confirmation: archiveConfirmation,
    }));
    if (result) {
      setArchiving(null);
      setNotice(sw ? 'Kipindi cha malipo kimehifadhiwa kwenye kumbukumbu. Sasa unaweza kuunda kipindi kipya kwa tarehe hizi.' : 'Pay period archived. You can now create a fresh period for these dates.');
      await periods.reload();
    }
  };
  const removePeriod = async (period: PayPeriod) => {
    const name = period.period_label || `${period.start_date} – ${period.end_date}`;
    if (!(await confirmAction({
      title: sw ? `Futa ${name}?` : `Delete ${name}?`,
      message: sw
        ? 'Kipindi hiki kitaondolewa kabisa. Hili haliwezi kutenduliwa.'
        : 'This pay period is removed for good. This cannot be undone.',
      confirmLabel: sw ? 'Futa kipindi' : 'Delete period',
      danger: true,
    }))) return;
    const result = await deletion.run(() => api.del(`/admin/pay-periods/${period.id}`));
    if (result) { setNotice(sw ? 'Kipindi kisichotumika kimefutwa.' : 'Unused pay period deleted.'); await periods.reload(); }
  };
  const technicalOnly = hasRole('TECHNICAL_OFFICER') && !hasRole('CENTRAL_ADMIN', 'FHI360_FINANCE', 'SUPER_ADMIN');
  const canCreate = technicalOnly ? (regions.data?.length || 0) > 0 : hasRole('CENTRAL_ADMIN', 'FHI360_FINANCE', 'SUPER_ADMIN');
  const sortedPeriods = [...(periods.data || [])].sort((a, b) => b.end_date.localeCompare(a.end_date) || a.start_date.localeCompare(b.start_date));

  const refresh = async () => {
    setEditing(undefined);
    setNotice(sw ? 'Kipindi cha malipo kimehifadhiwa.' : 'Pay period saved.');
    await periods.reload();
  };

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <h1>{sw ? 'Vipindi vya malipo' : 'Pay periods'}</h1>
        </div>
        {canCreate && <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setEditing(null); }}>{sw ? 'Weka kipindi' : 'Set up period'}</button>}
      </header>
      {technicalOnly && <p className="muted small">{sw ? 'Unaweza kuhariri mikoa uliyopangiwa tu; vipindi vya jumla ni vya kusoma tu.' : 'You can edit only your assigned regions; global periods are read-only.'}</p>}
      <Alert>{periods.error || regions.error || deletion.error}</Alert>
      {(periods.error || regions.error) && (
        <div className="row">
          {periods.error && <button type="button" className="btn btn-secondary btn-sm" onClick={periods.reload}>{sw ? 'Jaribu tena vipindi' : 'Retry periods'}</button>}
          {regions.error && <button type="button" className="btn btn-secondary btn-sm" onClick={regions.reload}>{sw ? 'Jaribu tena mikoa' : 'Retry regions'}</button>}
        </div>
      )}
      <Alert kind="success">{notice}</Alert>
      {hasRole('SUPER_ADMIN') && <label className="row">
        <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
        {sw ? 'Jumuisha vipindi vilivyohifadhiwa (historia ya kusoma tu)' : 'Include archived periods (read-only history)'}
      </label>}
      {(periods.loading && !periods.data) || (regions.loading && !regions.data) ? (
        <section className="card stack" aria-label={sw ? 'Inapakia vipindi vya malipo' : 'Loading pay periods'}>
          <div className="loading" style={{ minHeight: 18 }} />
          <div className="loading" style={{ minHeight: 18, width: '72%' }} />
          <div className="loading" style={{ minHeight: 18, width: '54%' }} />
        </section>
      ) : periods.data && sortedPeriods.length === 0 ? (
        <section className="card stack">
          <h2>{sw ? 'Bado hakuna vipindi vya malipo' : 'No pay periods yet'}</h2>
          {canCreate && <div><button type="button" className="btn btn-primary" onClick={() => setEditing(null)}>{sw ? 'Weka kipindi cha kwanza' : 'Set up first period'}</button></div>}
        </section>
      ) : (
        <section className="card stack">
          <div className="section-title">
            <h2>{sw ? 'Ratiba' : 'Schedules'}</h2>
            <span>{sw ? `Vipindi ${sortedPeriods.length}` : `${sortedPeriods.length} period${sortedPeriods.length === 1 ? '' : 's'}`}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{sw ? 'Kipindi' : 'Period'}</th><th>{sw ? 'Tarehe' : 'Date span'}</th><th>{sw ? 'Ratiba' : 'Schedule'}</th><th>{sw ? 'Hali' : 'Status'}</th><th><span className="sr-only">{sw ? 'Hatua' : 'Actions'}</span></th></tr></thead>
              <tbody>
                {sortedPeriods.map((period) => (
                  <tr key={period.id}>
                    <td><span className="cell-main">{period.period_label || (sw ? 'Kipindi bila jina' : 'Untitled period')}</span><span className="cell-sub">#{period.id}</span></td>
                    <td className="nowrap">{dateOnly(period.start_date)} – {dateOnly(period.end_date)}</td>
                    <td>{period.region_id == null ? <span className="badge badge-neutral">{sw ? 'Ratiba ya jumla' : 'Global schedule'}</span> : period.region_name || (sw ? 'Ratiba ya mkoa' : 'Regional schedule')}</td>
                    <td><StatusBadge status={period.status} /></td>
                    <td className="num"><div className="row" style={{ justifyContent: 'flex-end' }}>
                      {hasRole('SUPER_ADMIN') && <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => setRecordsPeriod(period)}>{sw ? 'Kumbukumbu za watoa huduma' : 'Provider records'}</button>}
                      {period.can_manage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setNotice(null); setEditing(period); }}>{sw ? 'Hariri' : 'Edit'}</button>}
                      {hasRole('SUPER_ADMIN') && <button type="button" className="btn btn-danger btn-sm" disabled={!period.can_delete || deletion.busy} onClick={() => removePeriod(period)}>{sw ? 'Futa' : 'Delete'}</button>}
                      {hasRole('SUPER_ADMIN') && period.status !== 'ARCHIVED' && <>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={!period.can_archive || deletion.busy}
                          title={period.archive_block_reason || (sw ? 'Hifadhi historia na uruhusu kipindi kipya kwa tarehe hizi' : 'Preserve history and allow a fresh period for these dates')}
                          onClick={() => { setArchiveReason(''); setArchiveConfirmation(''); setArchiving(period); }}>{sw ? 'Hifadhi / anza upya' : 'Archive / restart'}</button>
                        {period.archive_block_reason && <div className="muted small">{period.archive_block_reason}</div>}
                      </>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasRole('SUPER_ADMIN') && sortedPeriods.some((period) => !period.can_delete) && <p className="muted small table-note">
            {sw
              ? 'Futa inafanya kazi kwa kipindi kisicho na kumbukumbu za kazi, madai wala mistari ya bajeti tu. Kuanza upya kipindi kinachotumika, tumia “Hifadhi / anza upya”: historia inabaki.'
              : 'Delete works only for a period with no work logs, claims or budget lines. To restart a period in use, use “Archive / restart”: its history is kept.'}
          </p>}
        </section>
      )}
      {editing !== undefined && (
        <PayPeriodForm
          key={editing?.id ?? 'new'}
          period={editing}
          regions={regions.data || []}
          technicalOnly={technicalOnly}
          onClose={() => setEditing(undefined)}
          onSaved={refresh}
        />
      )}
      {recordsPeriod && <ProviderPeriodRecords period={recordsPeriod} onClose={() => setRecordsPeriod(null)} />}
      {archiving && <Modal title={sw ? 'Hifadhi kipindi cha malipo na uanze upya' : 'Archive pay period and start again'} onClose={() => { if (!deletion.busy) setArchiving(null); }}>
        <form className="stack" onSubmit={archivePeriod}>
          <Alert kind="warn">{sw
            ? `Hifadhi ${archiving.period_label || 'kipindi hiki'} (${dateOnly(archiving.start_date)} – ${dateOnly(archiving.end_date)})? Kazi na idhini zake zitakuwa za kusoma tu na kuondoka kwenye orodha za kazi. Hili halifuti historia wala kuhamisha malipo au bajeti.`
            : `Archive ${archiving.period_label || 'this period'} (${dateOnly(archiving.start_date)} – ${dateOnly(archiving.end_date)})? Its work and approvals become read-only and leave active lists. This does not erase history or move payments or budgets.`}</Alert>
          <Alert>{deletion.error}</Alert>
          <Field label={sw ? 'Sababu ya kuhifadhi' : 'Reason for archiving'}><textarea required minLength={3} maxLength={1000} value={archiveReason}
            disabled={deletion.busy} onChange={event => setArchiveReason(event.target.value)} /></Field>
          <Field label={sw ? `Andika ARCHIVE ${archiving.id} kuthibitisha` : `Type ARCHIVE ${archiving.id} to confirm`}><input required value={archiveConfirmation}
            disabled={deletion.busy} autoComplete="off" onChange={event => setArchiveConfirmation(event.target.value)} /></Field>
          <div className="row">
            <button type="submit" className="btn btn-danger" disabled={deletion.busy || archiveReason.trim().length < 3 || archiveConfirmation !== `ARCHIVE ${archiving.id}`}>{sw ? 'Hifadhi kipindi' : 'Archive period'}</button>
            <button type="button" className="btn btn-ghost" disabled={deletion.busy} onClick={() => setArchiving(null)}>{sw ? 'Ghairi' : 'Cancel'}</button>
          </div>
        </form>
      </Modal>}
    </div>
  );
}
