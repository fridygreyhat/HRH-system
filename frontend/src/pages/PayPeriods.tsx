import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { dateOnly } from '../format';
import { useAction, useApi } from '../hooks';
import { Named, PayPeriod } from '../types';
import { Alert, Field, Modal, StatusBadge } from '../components/ui';
import { ProviderPeriodRecords } from './ProviderPeriodRecords';

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
      setFormError('The end date must be on or after the start date.');
      return;
    }
    if (!regionId) {
      setFormError(technicalOnly ? 'Choose one of your assigned regions.' : 'Choose a region or the global schedule.');
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
    <Modal title={period ? 'Edit pay period' : 'Set up pay period'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">
          Edit the label and open/closed status after creation. Dates can also be corrected for unused or draft-only periods, provided every saved workday remains inside the period.
        </p>
        {datesLocked && <Alert kind="info">{period?.date_lock_reason || 'Submitted records, claims or budgets protect these dates. You can still edit the label and status.'}</Alert>}
        <div className="grid-2">
          <Field label="Start date">
            <input type="date" required disabled={datesLocked} value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="End date">
            <input type="date" required disabled={datesLocked} value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
        </div>
        <Field label="Period label" hint="A short name staff and finance teams will recognize.">
          <input required maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. October 2026" />
        </Field>
        <Field label="Region" hint={technicalOnly ? 'Technical Officers can manage periods only for their assigned regions.' : 'A regional period is separate from the global schedule.'}>
          <select required value={regionId} disabled={!!period} onChange={(event) => setRegionId(event.target.value)}>
            <option value="">Choose a region…</option>
            {!technicalOnly && <option value="global">Global schedule</option>}
            {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="OPEN">Open for work logs</option>
            <option value="CLOSED">Closed</option>
          </select>
        </Field>
        <Alert>{formError || error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !startDate || !endDate || !label.trim() || !regionId}>
            {busy ? 'Saving…' : period ? 'Save changes' : 'Create pay period'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export function PayPeriods() {
  const { hasRole } = useAuth();
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
      setNotice('Pay period archived. Its work and approval history are preserved. You can now create a fresh period for the same dates.');
      await periods.reload();
    }
  };
  const removePeriod = async (period: PayPeriod) => {
    if (!window.confirm(`Delete ${period.period_label || `${period.start_date} – ${period.end_date}`}? This cannot be undone. Periods with work logs, claims or budget lines cannot be deleted.`)) return;
    const result = await deletion.run(() => api.del(`/admin/pay-periods/${period.id}`));
    if (result) { setNotice('Unused pay period deleted.'); await periods.reload(); }
  };
  const technicalOnly = hasRole('TECHNICAL_OFFICER') && !hasRole('CENTRAL_ADMIN', 'FHI360_FINANCE', 'SUPER_ADMIN');
  const canCreate = technicalOnly ? (regions.data?.length || 0) > 0 : hasRole('CENTRAL_ADMIN', 'FHI360_FINANCE', 'SUPER_ADMIN');
  const sortedPeriods = [...(periods.data || [])].sort((a, b) => b.end_date.localeCompare(a.end_date) || a.start_date.localeCompare(b.start_date));

  const refresh = async () => {
    setEditing(undefined);
    setNotice('Pay period saved.');
    await periods.reload();
  };

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <h1>Pay periods</h1>
          <p className="muted">Schedules that define when providers can record work and finance teams can prepare payments.</p>
        </div>
        {canCreate && <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setEditing(null); }}>Set up period</button>}
      </header>
      <div className="notice notice-info">
        <strong>Regional schedules are independent.</strong> A period created for one region does not replace or change another region’s schedule.
        {technicalOnly && <div className="small" style={{ marginTop: '.35rem' }}>You can create and edit periods only for your assigned region(s). Existing global periods are visible for reference and remain read-only.</div>}
      </div>
      <Alert>{periods.error || regions.error || deletion.error}</Alert>
      {(periods.error || regions.error) && (
        <div className="row">
          {periods.error && <button type="button" className="btn btn-secondary btn-sm" onClick={periods.reload}>Retry periods</button>}
          {regions.error && <button type="button" className="btn btn-secondary btn-sm" onClick={regions.reload}>Retry regions</button>}
        </div>
      )}
      <Alert kind="success">{notice}</Alert>
      {hasRole('SUPER_ADMIN') && <label className="row">
        <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
        Include archived periods (read-only history)
      </label>}
      {(periods.loading && !periods.data) || (regions.loading && !regions.data) ? (
        <section className="card stack" aria-label="Loading pay periods">
          <div className="loading" style={{ minHeight: 18 }} />
          <div className="loading" style={{ minHeight: 18, width: '72%' }} />
          <div className="loading" style={{ minHeight: 18, width: '54%' }} />
        </section>
      ) : periods.data && sortedPeriods.length === 0 ? (
        <section className="card stack">
          <h2>No pay periods yet</h2>
          <p className="muted">{technicalOnly ? 'Create a regional period to establish the schedule for your assigned region.' : 'Create a global schedule or a regional period to get started.'}</p>
          {canCreate && <div><button type="button" className="btn btn-primary" onClick={() => setEditing(null)}>Set up first period</button></div>}
        </section>
      ) : (
        <section className="card stack">
          <div className="row-between">
            <h2>Schedules</h2>
            <span className="muted small">{sortedPeriods.length} period{sortedPeriods.length === 1 ? '' : 's'}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th>Date span</th><th>Schedule</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {sortedPeriods.map((period) => (
                  <tr key={period.id}>
                    <td><strong>{period.period_label || 'Untitled period'}</strong><div className="muted small">#{period.id}</div></td>
                    <td className="nowrap">{dateOnly(period.start_date)} – {dateOnly(period.end_date)}</td>
                    <td>{period.region_id == null ? <span className="badge badge-neutral">Global schedule</span> : period.region_name || 'Regional schedule'}</td>
                    <td><StatusBadge status={period.status} /></td>
                    <td className="num">
                      {hasRole('SUPER_ADMIN') && <button type="button" className="btn btn-secondary btn-sm"
                        onClick={() => setRecordsPeriod(period)}>Provider records</button>}
                      {period.can_manage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setNotice(null); setEditing(period); }}>Edit</button>}
                      {hasRole('SUPER_ADMIN') && <button type="button" className="btn btn-danger btn-sm" disabled={!period.can_delete || deletion.busy} title={period.can_delete ? 'Delete unused period' : 'In use: archive unpaid periods to restart while retaining history'} onClick={() => removePeriod(period)}>Delete</button>}
                      {hasRole('SUPER_ADMIN') && period.status !== 'ARCHIVED' && <>
                        <button type="button" className="btn btn-secondary btn-sm" disabled={!period.can_archive || deletion.busy}
                          title={period.archive_block_reason || 'Preserve history and allow a fresh period for these dates'}
                          onClick={() => { setArchiveReason(''); setArchiveConfirmation(''); setArchiving(period); }}>Archive / restart</button>
                        {period.archive_block_reason && <div className="muted small">{period.archive_block_reason}</div>}
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Super Admin can delete unused periods or archive used, unpaid periods to start again. Archiving hides old work from active lists without erasing entries, approvals or audit history. Paid work and active claims remain protected.</p>
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
      {archiving && <Modal title="Archive pay period and start again" onClose={() => { if (!deletion.busy) setArchiving(null); }}>
        <form className="stack" onSubmit={archivePeriod}>
          <Alert kind="warn">Archive {archiving.period_label || 'this period'} ({dateOnly(archiving.start_date)} – {dateOnly(archiving.end_date)})?
            Its timesheets, Services, approvals and audit history will become read-only and leave active work lists.
            This does not erase history or move payments or budgets. Create a fresh period afterwards so providers can refill their actual work.</Alert>
          <Alert>{deletion.error}</Alert>
          <Field label="Reason for archiving"><textarea required minLength={3} maxLength={1000} value={archiveReason}
            disabled={deletion.busy} onChange={event => setArchiveReason(event.target.value)} /></Field>
          <Field label={`Type ARCHIVE ${archiving.id} to confirm`}><input required value={archiveConfirmation}
            disabled={deletion.busy} autoComplete="off" onChange={event => setArchiveConfirmation(event.target.value)} /></Field>
          <div className="row">
            <button type="submit" className="btn btn-danger" disabled={deletion.busy || archiveReason.trim().length < 3 || archiveConfirmation !== `ARCHIVE ${archiving.id}`}>Archive period</button>
            <button type="button" className="btn btn-ghost" disabled={deletion.busy} onClick={() => setArchiving(null)}>Cancel</button>
          </div>
        </form>
      </Modal>}
    </div>
  );
}
