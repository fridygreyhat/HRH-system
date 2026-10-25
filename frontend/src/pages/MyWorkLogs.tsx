import React, { useState } from 'react';
import { MiniStepper } from '../components/worklogs/ApprovalStepper';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { WorkLogEditor } from '../components/worklogs/WorkLogEditor';
import { Alert, AsyncState, Field, StatusBadge } from '../components/ui';
import { dateOnly, num, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';
import { PayPeriod, WorkLogDetail, WorkLogSummary } from '../types';
import { resolveWorkLogStart } from './workLogStart';

export function MyWorkLogs() {
  const { me, t } = useAuth();
  const isHcp = me?.cadre?.code === 'HCP';
  const logs = useApi<WorkLogSummary[]>('/worklogs?mine=true');
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editorDate, setEditorDate] = useState<string | undefined>();
  const [workType, setWorkType] = useState<'SERVICES' | 'PAYROLL'>('SERVICES');
  const [workDate, setWorkDate] = useState(todayLocal());
  const { busy, error, run } = useAction();
  const resolution = resolveWorkLogStart(periods.data || [], logs.data || [], workType, workDate);
  const loadingStartData = periods.loading || logs.loading;
  const startDataError = periods.error || logs.error;

  if (openId !== null) {
    return (
      <WorkLogEditor
        logId={openId}
        initialDate={editorDate}
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
    setEditorDate(workDate);
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
    ? 'Record service activity for the selected work date.'
    : 'Record your daily facility timesheet for the selected work date.';
  const typeEyebrow = workType === 'SERVICES' ? 'SERVICE RECORD' : 'DAILY TIMESHEET';
  const cascadePreviewCount = workType === 'SERVICES' ? 6 : 3;

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
            <p>Choose the record type and date to continue or begin.</p>
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
          <Field label="Work date" hint="Choose a date up to today.">
            <input
              type="date"
              required
              max={todayLocal()}
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
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
          </div>
          <div className="worklog-type-date">
            <span className="worklog-date-label">Selected work date</span>
            <strong>{dateOnly(workDate)}</strong>
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
          <p className="worklog-start-note" role="status">{t('noOpenPeriods')}</p>
        )}
        {resolution.error && !startDataError && hasExisting && (
          <p className="worklog-start-note" role="status">{resolution.error}</p>
        )}

        <div className="worklog-start-actions">
          <p className="worklog-start-guidance">
            {hasExisting
              ? `A ${typeTitle.toLowerCase()} record already exists for this period. Continue it to add or review entries.`
              : resolution.period
                ? `Ready for ${dateOnly(workDate)}${resolution.period.period_label ? ` · ${resolution.period.period_label}` : ''}.`
                : 'A work log can be started when an open period covers this date.'}
          </p>
          <button className="btn btn-primary btn-lg" disabled={disableStart}>
            {busy ? t('loading') : hasExisting ? `Continue ${typeTitle}` : `Start ${typeTitle}`}
          </button>
        </div>
        <Alert>{error}</Alert>
      </form>

      <AsyncState data={logs.data} error={logs.error} loading={logs.loading} empty={t('noLogs')}>
        {(rows) => (
          <div className="stack">
            {rows.map((l) => (
              <button key={l.id} type="button" className="card log-card" onClick={() => { setEditorDate(undefined); setOpenId(l.id); }} aria-label={`${t('open')} ${l.period_label}`}>
                <div className="row-between">
                  <strong>{l.period_label}</strong>
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
