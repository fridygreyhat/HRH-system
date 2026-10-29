import React, { useState } from 'react';
import { MiniStepper } from '../components/worklogs/ApprovalStepper';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { WorkLogEditor } from '../components/worklogs/WorkLogEditor';
import { Alert, AsyncState, Field, StatusBadge } from '../components/ui';
import { num, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';
import { PayPeriod, WorkLogDetail, WorkLogSummary } from '../types';
import { resolveWorkLogMonth, workMonthLabel } from './workLogStart';

export function MyWorkLogs() {
  const { me, t } = useAuth();
  const isHcp = me?.cadre?.code === 'HCP';
  const isChw = me?.cadre?.code === 'CHW';
  const logs = useApi<WorkLogSummary[]>('/worklogs?mine=true');
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editorMonth, setEditorMonth] = useState<string | undefined>();
  const [workType, setWorkType] = useState<'SERVICES' | 'PAYROLL'>('SERVICES');
  const [workMonth, setWorkMonth] = useState(todayLocal().slice(0, 7));
  const { busy, error, run } = useAction();
  const resolution = resolveWorkLogMonth(periods.data || [], logs.data || [], workType, workMonth);
  const loadingStartData = periods.loading || logs.loading;
  const startDataError = periods.error || logs.error;

  if (openId !== null) {
    return (
      <WorkLogEditor
        logId={openId}
        initialMonth={editorMonth}
        onBack={() => {
          setOpenId(null);
          logs.reload();
        }}
      />
    );
  }

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disableStart) return;
    setEditorMonth(workMonth);
    if (resolution.existing) {
      setOpenId(resolution.existing.id);
      return;
    }
    if (!resolution.period || !me?.staff || loadingStartData || startDataError) return;
    const created = await run(() => api.post<WorkLogDetail>('/worklogs', { period_id: resolution.period!.id, work_type: workType }));
    if (created) {
      setOpenId(created.id);
    }
  };

  const hasExisting = Boolean(resolution.existing);
  const disableStart = busy || loadingStartData || Boolean(startDataError) || !me?.staff || (!hasExisting && !resolution.period);
  const typeTitle = workType === 'SERVICES' ? 'Services' : 'Payroll';
  const typeDescription = workType === 'SERVICES'
    ? 'Record your actual service activities on the dates you worked during this month.'
    : 'Fill your daily timesheet across the selected month, choosing each date you actually worked.';
  const typeEyebrow = workType === 'SERVICES' ? 'SERVICE RECORD' : 'DAILY TIMESHEET';
  const cascadePreviewCount = workType === 'SERVICES' ? 6 : 3;
  const chwService = me?.cadre?.activities?.find((activity) => activity.key === 'chw_weekend_clinic');
  const chwPayroll = me?.cadre?.activities?.find((activity) => activity.key === 'chw_daily_timesheet');

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <h1>{t('myWorkLogs')}</h1>
          {me?.cadre && <p className="muted small">{me.cadre.form_title || me.cadre.name}</p>}
        </div>
      </header>

      {!me?.staff && (
        <Alert kind="warn">
          Your account is not linked to a staff record (CHW, Data Clerk or HCP), so you cannot start work logs yet. A system administrator can link it
          under Administration → Users → Manage.
        </Alert>
      )}

      <form className={`worklog-start-card worklog-start-${workType.toLowerCase()}`} onSubmit={start}>
        <div className="worklog-start-intro">
          <div>
            <span className="worklog-start-kicker">{t('startLog')}</span>
            <h2>{isHcp ? 'Timesheet / activity type' : 'Choose a work log'}</h2>
            <p>Choose Services or Payroll and the month. Rejected work reopens in the same record for correction.</p>
          </div>
          <span className="worklog-start-mark" aria-hidden="true">{workType === 'SERVICES' ? 'S' : 'P'}</span>
        </div>

        <div className="worklog-start-controls">
          <Field label={isHcp ? 'Timesheet / activity type' : 'Work type'}>
            <select
              value={workType}
              onChange={(e) => setWorkType(e.target.value as 'SERVICES' | 'PAYROLL')}
              aria-label={isHcp ? 'Timesheet / activity type' : 'Work type'}
            >
              <option value="SERVICES">Services</option>
              <option value="PAYROLL">Payroll</option>
            </select>
          </Field>
          <Field label="Work month" hint="Choose the month you want to fill or correct.">
            <input
              type="month"
              required
              max={todayLocal().slice(0, 7)}
              value={workMonth}
              onChange={(e) => setWorkMonth(e.target.value)}
            />
          </Field>
        </div>

        <section className="worklog-type-panel" aria-live="polite" aria-labelledby="worklog-type-title">
          <div className="worklog-type-copy">
            <span className="worklog-type-eyebrow">{typeEyebrow}</span>
            <h3 id="worklog-type-title">{typeTitle}</h3>
            <p>{typeDescription}</p>
            {isHcp && (
              <div className="worklog-cascade-preview">
                <span className="worklog-cascade-count">{cascadePreviewCount}</span>
                <span>{workType === 'SERVICES' ? 'service cascades' : 'daily facility cascades'} in this record</span>
              </div>
            )}
            {isChw && (
              <div className="worklog-cascade-preview" aria-label="CHW activity overview">
                {workType === 'SERVICES' ? (
                  <>
                    <span className="worklog-cascade-count">{chwService?.fields.length ?? 1}</span>
                    <span>Special and Weekend Clinics</span>
                  </>
                ) : (
                  <>
                    <span className="worklog-cascade-count">{chwPayroll?.fields.length ?? 14}</span>
                    <span>indicators · {chwPayroll?.groups?.length ?? 5} groups</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="worklog-type-date">
            <span className="worklog-date-label">Selected month</span>
            <strong>{workMonthLabel(workMonth)}</strong>
          </div>
        </section>

        {loadingStartData && (
          <div className="worklog-start-loading" role="status" aria-label="Checking work log availability">
            <span />
            <span />
            <span />
          </div>
        )}
        {startDataError && <Alert>{startDataError}</Alert>}
        {resolution.error && !startDataError && !hasExisting && <Alert kind="warn">{resolution.error}</Alert>}
        {!loadingStartData && !startDataError && !resolution.period && !hasExisting && !resolution.error && (
          <p className="worklog-start-note" role="status">No monthly schedule is available. Contact your regional Technical Officer.</p>
        )}
        {resolution.error && !startDataError && hasExisting && (
          <p className="worklog-start-note" role="status">{resolution.error}</p>
        )}

        <div className="worklog-start-actions">
          <p className="worklog-start-guidance">
            {hasExisting
              ? ['REJECTED', 'RETURNED_TO_PROVIDER'].includes(resolution.existing!.status)
                ? `Your ${typeTitle.toLowerCase()} record for ${workMonthLabel(workMonth)} needs correction. Open it, fill or correct the eligible dates across the month, then submit again.`
                : `A ${typeTitle.toLowerCase()} record already exists for ${workMonthLabel(workMonth)}. Open it to continue or review your work.`
              : resolution.period
                ? `Ready to fill ${workMonthLabel(workMonth)}. Select the actual workdays in the calendar.`
                : 'Your regional Technical Officer can open the monthly schedule for new work.'}
          </p>
          <button className="btn btn-primary btn-lg" disabled={disableStart}>
            {busy ? t('loading') : hasExisting
              ? ['REJECTED', 'RETURNED_TO_PROVIDER'].includes(resolution.existing!.status) ? `Correct ${typeTitle}` : `Open ${typeTitle}`
              : `Start ${typeTitle}`}
          </button>
        </div>
        <Alert>{error?.replace(/pay period/gi, 'work month')}</Alert>
      </form>

      <AsyncState data={logs.data} error={logs.error} loading={logs.loading} empty={t('noLogs')}>
        {(rows) => (
          <div className="stack">
            {rows.map((l) => (
              <button key={l.id} type="button" className="card log-card" onClick={() => { setEditorMonth(undefined); setOpenId(l.id); }} aria-label={`${t('open')} ${recordMonth(l, periods.data || [])}`}>
                <div className="row-between">
                  <strong>{recordMonth(l, periods.data || [])}</strong>
                  <span className="row"><span className="badge badge-neutral">{l.work_type === 'LEGACY' ? 'Legacy' : l.work_type === 'SERVICES' ? 'Services' : l.work_type === 'PAYROLL' && isHcp ? 'Daily timesheet · Payroll' : l.work_type}</span><StatusBadge kind="log" status={l.status} /></span>
                </div>
                <MiniStepper status={l.status} />
                <div className="muted small">
                  {num(l.entry_count)} {t('days').toLowerCase()} · {num(l.total_hours)} {t('hours').toLowerCase()} · #{l.id}
                </div>
              </button>
            ))}
          </div>
        )}
      </AsyncState>
    </div>
  );
}

function recordMonth(log: WorkLogSummary, periods: PayPeriod[]): string {
  const period = periods.find(p => p.id === log.period_id);
  if (!period) return 'Monthly work record';
  const start = period.start_date.slice(0, 7);
  const end = period.end_date.slice(0, 7);
  return start === end ? workMonthLabel(start) : `${workMonthLabel(start)} – ${workMonthLabel(end)}`;
}
