import React, { useState } from 'react';
import { MiniStepper } from '../components/worklogs/ApprovalStepper';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { WorkLogEditor } from '../components/worklogs/WorkLogEditor';
import { Icon } from '../components/Icon';
import { Alert, AsyncState, Field, StatusBadge, WorkTypeChip } from '../components/ui';
import { num, payMonth, payMonthDates, todayLocal, workHours, workTypeName } from '../format';
import { useAction, useApi } from '../hooks';
import { PayPeriod, WorkLogDetail, WorkLogSummary } from '../types';
import { resolveWorkLogMonth, workMonthLabel } from './workLogStart';
import './polish-provider.css';

export function MyWorkLogs() {
  const { me, t, lang } = useAuth();
  const sw = lang === 'sw';
  const isHcp = me?.cadre?.code === 'HCP';
  const isChw = me?.cadre?.code === 'CHW';
  const logs = useApi<WorkLogSummary[]>('/worklogs?mine=true');
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const [openId, setOpenId] = useState<number | null>(null);
  const [editorMonth, setEditorMonth] = useState<string | undefined>();
  const [workType, setWorkType] = useState<'SERVICES' | 'PAYROLL'>('SERVICES');
  const [workMonth, setWorkMonth] = useState(payMonth(todayLocal()));
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
  const typeName = workTypeName(workType, sw ? 'sw' : 'en');
  const typeDescription = workType === 'SERVICES'
    ? (sw ? 'Rekodi huduma kwa tarehe ulizofanya kazi.' : 'Record services on the dates you worked.')
    : (sw ? 'Jaza jedwali lako kwa kila tarehe uliyofanya kazi.' : 'Fill your timesheet for each date you worked.');
  const cascadePreviewCount = workType === 'SERVICES' ? 6 : 3;
  const chwService = me?.cadre?.activities?.find((activity) => activity.key === 'chw_weekend_clinic');
  const chwPayroll = me?.cadre?.activities?.find((activity) => activity.key === 'chw_daily_timesheet');
  const monthText = workMonthLabel(workMonth, lang);
  const needsCorrection = hasExisting && NEEDS_CORRECTION.includes(resolution.existing!.status);
  const startError = resolution.error && sw ? START_ERRORS_SW[resolution.error] || resolution.error : resolution.error;
  const startLabel = busy ? t('loading') : hasExisting
    ? needsCorrection ? (sw ? `Rekebisha ${typeName}` : `Correct ${typeTitle}`) : (sw ? `Fungua ${typeName}` : `Open ${typeTitle}`)
    : (sw ? `Anza ${typeName}` : `Start ${typeTitle}`);

  return (
    <div className="stack-lg my-logs">
      <header className="page-header">
        <div>
          <h1>{t('myWorkLogs')}</h1>
          {me?.cadre && <p className="muted small">{me.cadre.form_title || me.cadre.name}</p>}
        </div>
      </header>

      {!me?.staff && (
        <Alert kind="warn">
          {sw ? 'Akaunti yako haijaunganishwa na rekodi ya mtumishi. Muombe msimamizi aiunganishe.' : 'Your account is not linked to a staff record. Ask an administrator to link it.'}
        </Alert>
      )}

      <form className={`worklog-start-card worklog-start-${workType.toLowerCase()}`} onSubmit={start}>
        <div className="worklog-start-intro">
          <div>
            <h2>{sw ? 'Chagua kumbukumbu ya kazi' : isHcp ? 'Timesheet / activity type' : 'Choose a work log'}</h2>
          </div>
          <span className="worklog-start-mark" aria-hidden="true">{workType === 'SERVICES' ? 'S' : 'P'}</span>
        </div>

        <div className="worklog-start-controls">
          <Field label={sw ? 'Aina ya kazi' : isHcp ? 'Timesheet / activity type' : 'Work type'}>
            <select
              value={workType}
              onChange={(e) => setWorkType(e.target.value as 'SERVICES' | 'PAYROLL')}
              aria-label={isHcp ? 'Timesheet / activity type' : 'Work type'}
            >
              <option value="SERVICES">{workTypeName('SERVICES', sw ? 'sw' : 'en')}</option>
              <option value="PAYROLL">{workTypeName('PAYROLL', sw ? 'sw' : 'en')}</option>
            </select>
          </Field>
          <Field label={sw ? 'Mwezi wa kazi' : 'Work month'} hint={`${payMonthDates(workMonth)}. ${sw ? 'Wasilisha tarehe 25.' : 'Submit on the 25th.'}`}>
            <input
              type="month"
              required
              max={payMonth(todayLocal())}
              value={workMonth}
              onChange={(e) => setWorkMonth(e.target.value)}
            />
          </Field>
        </div>

        <section className="worklog-type-panel" aria-live="polite" aria-labelledby="worklog-type-title">
          <div className="worklog-type-copy">
            <h3 id="worklog-type-title">{typeName}</h3>
            <p>{typeDescription}</p>
            {isHcp && (
              <div className="worklog-cascade-preview">
                <span className="worklog-cascade-count">{cascadePreviewCount}</span>
                <span>{workType === 'SERVICES'
                  ? (sw ? 'kaskedi za huduma katika rekodi hii' : 'service cascades in this record')
                  : (sw ? 'kaskedi za kila siku katika rekodi hii' : 'daily facility cascades in this record')}</span>
              </div>
            )}
            {isChw && (
              <div className="worklog-cascade-preview" aria-label={sw ? 'Muhtasari wa shughuli za CHW' : 'CHW activity overview'}>
                {workType === 'SERVICES' ? (
                  <>
                    <span className="worklog-cascade-count">{chwService?.fields.length ?? 1}</span>
                    <span>{sw ? 'Kliniki maalum na za mwisho wa wiki' : 'Special and Weekend Clinics'}</span>
                  </>
                ) : (
                  <>
                    <span className="worklog-cascade-count">{chwPayroll?.fields.length ?? 14}</span>
                    <span>{sw ? `viashiria · makundi ${chwPayroll?.groups?.length ?? 5}` : `indicators · ${chwPayroll?.groups?.length ?? 5} groups`}</span>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="worklog-type-date">
            <span className="worklog-date-label">{sw ? 'Mwezi uliochaguliwa' : 'Selected month'}</span>
            <strong>{monthText}</strong>
          </div>
        </section>

        {loadingStartData && (
          <div className="worklog-start-loading" role="status" aria-label={sw ? 'Inaangalia kumbukumbu zilizopo' : 'Checking work log availability'}>
            <span />
            <span />
            <span />
          </div>
        )}
        {startDataError && <Alert>{startDataError}</Alert>}
        {resolution.error && !startDataError && !hasExisting && <Alert kind="warn">{startError}</Alert>}
        {!loadingStartData && !startDataError && !resolution.period && !hasExisting && !resolution.error && (
          <p className="worklog-start-note" role="status">{sw ? 'Hakuna ratiba ya mwezi. Wasiliana na Afisa wa Ufundi wa mkoa wako.' : 'No monthly schedule is available. Contact your regional Technical Officer.'}</p>
        )}
        {resolution.error && !startDataError && hasExisting && (
          <p className="worklog-start-note" role="status">{startError}</p>
        )}

        <div className="worklog-start-actions">
          <p className="worklog-start-guidance">
            {hasExisting
              ? needsCorrection
                ? (sw ? `Rekodi yako ya ${typeName} ya ${monthText} inahitaji marekebisho.` : `Your ${typeTitle.toLowerCase()} record for ${monthText} needs correction.`)
                : (sw ? `Rekodi ya ${typeName} ya ${monthText} ipo.` : `A ${typeTitle.toLowerCase()} record exists for ${monthText}.`)
              : resolution.period
                ? (sw ? `Tayari kujaza ${monthText}.` : `Ready to fill ${monthText}.`)
                : (sw ? 'Hakuna ratiba iliyo wazi kwa mwezi huu.' : 'No schedule is open for this month.')}
          </p>
          <button className="btn btn-primary btn-lg" disabled={disableStart}>{startLabel}</button>
        </div>
        <Alert>{error?.replace(/pay period/gi, 'work month')}</Alert>
      </form>

      <section className="stack" aria-labelledby="my-records-title">
        <div className="section-title">
          <h2 id="my-records-title">{sw ? 'Rekodi zangu' : 'My records'}</h2>
          {logs.data && logs.data.length > 0 && <span>{sw ? `Rekodi ${num(logs.data.length)}` : `${num(logs.data.length)} ${logs.data.length === 1 ? 'record' : 'records'}`}</span>}
        </div>
        <AsyncState data={logs.data} error={logs.error} loading={logs.loading} empty={t('noLogs')}>
          {(rows) => (
            <div className="log-grid">
              {rows.map((l) => {
                const month = recordMonth(l, periods.data || [], lang);
                const fix = NEEDS_CORRECTION.includes(l.status);
                const editable = fix || l.status === 'DRAFT';
                return (
                  <button key={l.id} type="button" className={`card log-card${fix ? ' needs-fix' : ''}`} onClick={() => { setEditorMonth(undefined); setOpenId(l.id); }} aria-label={`${t('open')} ${month}`}>
                    <span className="log-card-head">
                      <span>
                        <span className="log-card-month">{month}</span>
                        <span className="cell-sub">{l.work_type === 'PAYROLL' && isHcp ? (sw ? 'Daftari la kila siku' : 'Daily timesheet') : `#${l.id}`}</span>
                      </span>
                      <WorkTypeChip type={l.work_type} />
                    </span>
                    <span className="log-card-status"><StatusBadge kind="log" status={l.status} bare /></span>
                    <MiniStepper status={l.status} />
                    <span className="log-card-foot">
                      <span className="log-card-figures">
                        <span><strong>{num(l.entry_count)}</strong> {t('days').toLowerCase()}</span>
                        <span><strong>{workHours(l.total_hours)}</strong> {t('hours').toLowerCase()}</span>
                      </span>
                      <span className={`log-card-action${fix ? ' is-fix' : ''}`}>
                        {fix ? (sw ? 'Rekebisha' : 'Correct') : editable ? (sw ? 'Endelea' : 'Continue') : t('open')}
                        <Icon name="chevron" size={16} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </AsyncState>
      </section>
    </div>
  );
}

const NEEDS_CORRECTION = ['REJECTED', 'RETURNED_TO_PROVIDER'];

const START_ERRORS_SW: Record<string, string> = {
  'Choose a valid work month.': 'Chagua mwezi sahihi wa kazi.',
  'Future work months are not available yet.': 'Miezi ijayo bado haijafunguliwa.',
  'Several records cover this month. Open the correct record from your records below.': 'Rekodi kadhaa zinahusu mwezi huu. Fungua rekodi sahihi hapa chini.',
  'Several schedules cover this month. Ask your regional Technical Officer to clarify the monthly dates.': 'Ratiba kadhaa zinahusu mwezi huu. Muombe Afisa wa Ufundi wa mkoa afafanue tarehe.',
  'This month is not open for new work records. Ask your regional Technical Officer to open the monthly schedule.': 'Mwezi huu haujafunguliwa kwa rekodi mpya. Muombe Afisa wa Ufundi wa mkoa afungue ratiba.',
};

function recordMonth(log: WorkLogSummary, periods: PayPeriod[], lang?: string): string {
  const period = periods.find(p => p.id === log.period_id);
  if (!period) return lang === 'sw' ? 'Rekodi ya mwezi' : 'Monthly work record';
  const start = payMonth(period.start_date);
  const end = payMonth(period.end_date);
  return start === end ? workMonthLabel(start, lang) : `${workMonthLabel(start, lang)} – ${workMonthLabel(end, lang)}`;
}
