import React, { useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { dateOnly } from '../format';
import { useAction, useApi } from '../hooks';
import { Named, PayPeriod } from '../types';
import { Alert, Field, Modal, StatusBadge } from '../components/ui';
import { OctoberWorkReset } from './OctoberWorkReset';

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
  const [regionId, setRegionId] = useState(period?.region_id ? String(period.region_id) : '');
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

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
      try {
        if (period) await api.put(`/admin/pay-periods/${period.id}`, body);
        else await api.post('/admin/pay-periods', body);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          throw new Error('This date span is already in use and cannot be changed. Keep the original dates; the period label and status can still be updated.');
        }
        throw cause;
      }
      return true;
    });
    if (saved) onSaved();
  };

  return (
    <Modal title={period ? 'Edit pay period' : 'Set up pay period'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">
          Period dates are protected once work records use them. You can still update a period label or open/closed status.
        </p>
        <div className="grid-2">
          <Field label="Start date">
            <input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="End date">
            <input type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
        </div>
        <Field label="Period label" hint="A short name staff and finance teams will recognize.">
          <input required maxLength={100} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. October 2026" />
        </Field>
        <Field label="Region" hint={technicalOnly ? 'Technical Officers can manage periods only for their assigned regions.' : 'A regional period is separate from the global schedule.'}>
          <select required value={regionId} disabled={technicalOnly && !!period} onChange={(event) => setRegionId(event.target.value)}>
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
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const regions = useApi<Named[]>('/admin/pay-period-regions');
  const [editing, setEditing] = useState<PayPeriod | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetPeriod, setResetPeriod] = useState<number | null>(null);
  const deletion = useAction();
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
                      {period.can_manage && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setNotice(null); setEditing(period); }}>Edit</button>}
                      {hasRole('SUPER_ADMIN') && <button type="button" className="btn btn-danger btn-sm" disabled={!period.can_delete || deletion.busy} title={period.can_delete ? 'Delete unused period' : 'In use: close this period instead'} onClick={() => removePeriod(period)}>Delete</button>}
                      {hasRole('SUPER_ADMIN') && period.start_date === '2026-10-01' && period.end_date === '2026-10-31' && !period.region_id && <button type="button" className="btn btn-danger btn-sm" onClick={() => setResetPeriod(period.id)}>Clear October work</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Super Admin can delete unused periods. Periods containing work logs, claims or budget lines must be closed instead, preserving their history.</p>
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
      {resetPeriod !== null && <OctoberWorkReset periodId={resetPeriod} onClose={() => setResetPeriod(null)} onDone={() => {
        setResetPeriod(null);
        setNotice('October work records cleared. The pay period, budget and audit history were preserved. Providers can start again.');
        periods.reload();
      }} />}
    </div>
  );
}
