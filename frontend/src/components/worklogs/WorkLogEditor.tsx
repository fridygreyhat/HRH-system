import { ApprovalStepper } from './ApprovalStepper';
import { AdminAudit } from '../AdminAudit';
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { datesBetween, dayOfMonth, money, num, todayLocal, WORKLOG_ACTION_LABELS, weekday } from '../../format';
import { useAction, useApi } from '../../hooks';
import { navigate } from '../../nav';
import { PayoutEstimateData, Section as SectionRow, WorkLogDetail } from '../../types';
import { Alert, AuditTimeline, Field, ReasonDialog, StatusBadge } from '../ui';
import { captureLocation, DayEntryForm } from './DayEntryForm';
import { OtpPanel } from './OtpPanel';
import { EntriesView, FlagsList, latestReturn, returnFlags, TotalsPanel } from './shared';

const WEEK_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_SW = ['Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijm', 'Jms', 'Jpl'];

export function HeaderForm({ log, onSaved }: { log: WorkLogDetail; onSaved: (l: WorkLogDetail) => void }) {
  const { t } = useAuth();
  const isHcp = log.cadre.code === 'HCP';
  const hidesPeriodComment = isHcp || ['CHW', 'DATA_CLERK'].includes(log.cadre.code);
  const sections = useApi<SectionRow[]>(log.cadre.uses_section ? '/admin/sections' : null);
  const [occupation, setOccupation] = useState(log.occupation || '');
  const [occupationOther, setOccupationOther] = useState(log.occupation_other || '');
  const [section, setSection] = useState(log.section || '');
  const [comment, setComment] = useState(log.period_comment || '');
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const options = log.cadre.occupation_options || [];
  const isOther = occupation.toLowerCase().startsWith('other');
  const a = log.assignment;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const body: Record<string, string | null> = {};
    if (!hidesPeriodComment) body.period_comment = comment.trim() || null;
    if (options.length && occupation) {
      body.occupation = occupation;
      body.occupation_other = isOther ? occupationOther.trim() : null;
    }
    if (log.cadre.uses_section && section) body.section = section;
    const result = await run(() => api.put<WorkLogDetail>(`/worklogs/${log.id}`, body));
    if (result) {
      setSaved(true);
      onSaved(result);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>{t('header')}</h3>
      <dl className="facts">
        {(
          [
            ['region', a?.region],
            ['district', a?.district],
            ['ward', a?.ward],
            ['facility', a?.facility],
            ['community', a?.community_area],
          ] as const
        )
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{t(k)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <div className="grid-2">
        {options.length > 0 && (
          <Field label={t('occupation')}>
            <select value={occupation} disabled={!log.can_edit} onChange={(e) => setOccupation(e.target.value)}>
              <option value="">—</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
        )}
        {options.length > 0 && isOther && (
          <Field label={t('occupationOther')}>
            <input required maxLength={100} disabled={!log.can_edit} value={occupationOther} onChange={(e) => setOccupationOther(e.target.value)} />
          </Field>
        )}
        {log.cadre.uses_section && (
          <Field label={t('section')}>
            <select value={section} disabled={!log.can_edit} onChange={(e) => setSection(e.target.value)}>
              <option value="">—</option>
              {(sections.data || []).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {!hidesPeriodComment && <Field label={t('periodComment')}>
        <textarea rows={2} maxLength={2000} disabled={!log.can_edit} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>}
      <Alert>{error || sections.error}</Alert>
      {saved && <Alert kind="success">{t('saved')}</Alert>}
      {log.can_edit && (
        <div className="row">
          <button className="btn btn-secondary" disabled={busy}>
            {busy ? t('saving') : t('saveDetails')}
          </button>
        </div>
      )}
    </form>
  );
}

/** One correctly aligned calendar month at a time, within the reporting period. */
export function DayCalendar({
  log,
  selected,
  flaggedDates,
  onSelect,
}: {
  log: WorkLogDetail;
  selected: string | null;
  flaggedDates: Set<string>;
  onSelect: (d: string) => void;
}) {
  const { t, lang } = useAuth();
  const today = todayLocal();
  const dates = useMemo(() => datesBetween(log.period.start_date, log.period.end_date),
    [log.period.start_date, log.period.end_date]);
  const months = useMemo(() => Array.from(new Set(dates.map(date => date.slice(0, 7)))), [dates]);
  const focusDate = selected && selected >= log.period.start_date && selected <= log.period.end_date
    ? selected : today >= log.period.start_date && today <= log.period.end_date ? today : log.period.start_date;
  const preferredMonth = focusDate.slice(0, 7);
  const [visibleMonth, setVisibleMonth] = useState(preferredMonth);
  useEffect(() => setVisibleMonth(preferredMonth), [preferredMonth, log.id]);
  const month = months.includes(visibleMonth) ? visibleMonth : preferredMonth;
  const monthIndex = months.indexOf(month);
  const visibleDates = dates.filter(date => date.startsWith(`${month}-`));
  const monthLabel = (value: string) => new Intl.DateTimeFormat(lang === 'sw' ? 'sw-TZ' : 'en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}-01T00:00:00Z`));
  const byDate = new Map(log.entries.map((e) => [e.entry_date, e]));
  const chwPayroll = ['CHW', 'HCP', 'DATA_CLERK'].includes(log.cadre.code) && log.work_type === 'PAYROLL';
  const sundayOff = !log.review_summary.limits.sunday_allowed;
  const missingDates = dates.filter(d => d <= today && !byDate.has(d) &&
    !(sundayOff && new Date(`${d}T00:00:00Z`).getUTCDay() === 0));
  // Restart Monday-first padding for each month, including partial periods.
  const firstDow = visibleDates.length ? (new Date(`${visibleDates[0]}T00:00:00Z`).getUTCDay() + 6) % 7 : 0;
  return (
    <section className="card stack" aria-labelledby="cal-title">
      <div className="row-between">
        <h3 id="cal-title">{t('calendar')}</h3>
        <span className="muted small">
          {lang === 'sw' ? 'Jumla ya kipindi' : 'Period total'} ·{' '}
          {num(log.entries.length)} {t('days').toLowerCase()} · {num(log.totals.hours)} {t('hours').toLowerCase()}
        </span>
      </div>
      <p className="muted small">{log.can_edit ? t('calendarHint') : t('locked')}</p>
      {chwPayroll && <div className="notice notice-info stack">
        <strong>{lang === 'sw' ? 'Jaza daftari la mwezi mzima' : `Complete your monthly ${log.cadre.code === 'DATA_CLERK' ? 'Data Clerk' : log.cadre.code} timesheet`}</strong>
        <p>{lang === 'sw'
          ? 'Chagua kila tarehe uliyofanya kazi. Jaza viashiria vyote vinavyohitajika, weka 0 ikiwa hakukuwa na shughuli, na nasa mahali ulipo kabla ya kuhifadhi.'
          : `Choose each date you actually worked. ${log.cadre.code === 'HCP' ? 'Choose your daily activity cascade and complete its indicators.' : 'Complete the required activity groups.'} Enter 0 where no activity occurred, and capture your location before saving.`}</p>
        <p className="small">{lang === 'sw'
          ? `Tarehe zilizopita bila rekodi: ${missingDates.length}. Hii haimaanishi ulifanya kazi siku zote.`
          : `${missingDates.length} past eligible dates have no entry. This does not mean you worked on every date.`}
          {' '}{lang === 'sw' ? 'Tarehe zijazo hazijafunguliwa.' : 'Future dates remain unavailable.'}
          {sundayOff && (lang === 'sw' ? ' Jumapili haziruhusiwi.' : ' Sundays are excluded.')}</p>
        {log.can_edit && missingDates.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSelect(missingDates[0])}>
          {lang === 'sw' ? 'Fungua tarehe inayofuata bila rekodi' : 'Open next date without an entry'}
        </button>}
      </div>}
      <nav className="calendar-navigation" aria-label={lang === 'sw' ? 'Chagua mwezi wa kalenda' : 'Calendar month navigation'}>
        <button type="button" className="btn btn-secondary btn-sm"
          aria-label={lang === 'sw' ? 'Mwezi uliotangulia' : 'Previous month'}
          disabled={monthIndex <= 0} onClick={() => setVisibleMonth(months[monthIndex - 1])}>‹</button>
        <select aria-label={lang === 'sw' ? 'Mwezi wa kalenda' : 'Calendar month'} value={month}
          onChange={event => setVisibleMonth(event.target.value)}>
          {months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}
        </select>
        <button type="button" className="btn btn-secondary btn-sm"
          aria-label={lang === 'sw' ? 'Mwezi unaofuata' : 'Next month'}
          disabled={monthIndex < 0 || monthIndex >= months.length - 1}
          onClick={() => setVisibleMonth(months[monthIndex + 1])}>›</button>
      </nav>
      <div className="calendar" role="grid" aria-label={`${t('calendar')} · ${monthLabel(month)}`}>
        {(lang === 'sw' ? WEEK_SW : WEEK_EN).map((d) => (
          <div key={d} className="calendar-head" role="columnheader">
            {d}
          </div>
        ))}
        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden />
        ))}
        {visibleDates.map((d) => {
          const entry = byDate.get(d);
          const future = d > today;
          const sunday = sundayOff && new Date(`${d}T00:00:00Z`).getUTCDay() === 0;
          const disabled = future || (!log.can_edit && !entry) || (chwPayroll && sunday && !entry);
          const classes = ['day', entry ? 'has-entry' : '', flaggedDates.has(d) ? 'is-flagged' : '', selected === d ? 'is-selected' : ''].filter(Boolean).join(' ');
          const state = future ? t('future') : chwPayroll && sunday && !entry ? (lang === 'sw' ? 'Jumapili hairuhusiwi' : 'Sunday excluded') : flaggedDates.has(d) ? t('flagged') : entry ? `${t('recorded')}: ${num(entry.hours_worked)} h` : '';
          return (
            <button
              key={d}
              type="button"
              className={classes}
              disabled={disabled}
              aria-pressed={selected === d}
              aria-label={`${weekday(d, lang)} ${d}${state ? ` – ${state}` : ''}`}
              onClick={() => onSelect(d)}
            >
              <span className="day-num">{dayOfMonth(d)}</span>
              <span className="day-meta">{entry ? `${num(entry.hours_worked)}h` : flaggedDates.has(d) ? '!' : ''}</span>
            </button>
          );
        })}
      </div>
      <div className="legend" aria-hidden>
        <span className="lg-entry">{t('recorded')}</span>
        <span className="lg-flag">{t('flagged')}</span>
        <span>{t('future')}</span>
      </div>
    </section>
  );
}

function SubmitPanel({ log, onSubmitted }: { log: WorkLogDetail; onSubmitted: (l: WorkLogDetail) => void }) {
  const { me, t } = useAuth();
  const [attest, setAttest] = useState(false);
  const { busy, error, run } = useAction();
  const gpsRequired = !!me?.client_settings.gps_required_on_submit;
  const gpsOnSubmit = gpsRequired || !!me?.client_settings.gps_capture_events.includes('SUBMIT');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await run(async () => {
      const fix = gpsOnSubmit ? await captureLocation() : null;
      if (gpsRequired && !fix) throw new Error(t('gpsRequired'));
      return api.post<WorkLogDetail>(`/worklogs/${log.id}/actions/submit`, { attest: true, ...(fix || {}) });
    });
    if (result) {
      setAttest(false);
      onSubmitted(result);
    }
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <h3>{t('submitTitle')}</h3>
      <label className="row" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} required />
        <span>{t('attest')}</span>
      </label>
      {gpsOnSubmit && <span className="field-hint">{t(gpsRequired ? 'gpsRequiredHint' : 'gpsHint')}</span>}
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={!attest || busy || log.entries.length === 0}>
          {busy ? t('submitting') : t('submit')}
        </button>
      </div>
    </form>
  );
}

/** What the log would earn under approved rates; clearly not an approved amount. */
function PayoutEstimate({ logId, version }: { logId: number; version: string }) {
  const { t } = useAuth();
  const { data } = useApi<PayoutEstimateData>(`/worklogs/${logId}/estimate?v=${encodeURIComponent(version)}`);
  if (!data) return null;
  return (
    <section className="card stack" aria-labelledby="estimate-title">
      <h3 id="estimate-title">{t('estimateTitle')}</h3>
      {data.totals.length ? (
        <>
          <p className="estimate-total">{data.totals.map((x) => money(x.amount, x.currency)).join(' + ')}</p>
          <ul className="muted small">
            {data.lines.map((l, i) => (
              <li key={i}>
                {l.category} · {l.component}: {num(Number(l.units))} × {money(l.rate, l.currency)} = {money(l.amount, l.currency)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{t('estimateNone')}</p>
      )}
      <span className="badge badge-warn" style={{ justifySelf: 'start' }}>{t('estimateNote')}</span>
    </section>
  );
}

/** Provider work-log editor: header, day-by-day entries, totals and submission. */
export function WorkLogEditor({ logId, initialDate, onBack }: { logId: number; initialDate?: string; onBack: () => void }) {
  const { me, t, lang } = useAuth();
  const { data: log, error, loading, setData, reload } = useApi<WorkLogDetail>(`/worklogs/${logId}`);
  const [selected, setSelected] = useState<string | null>(initialDate || null);
  const [cancelling, setCancelling] = useState(false);
  const flags = useMemo(() => (log ? returnFlags(log) : []), [log]);
  const flaggedDates = useMemo(() => new Set(flags.map((f) => f.entry_date)), [flags]);
  const captureOnEntry = !!me?.client_settings.gps_capture_events.includes('ENTRY');

  useEffect(() => {
    if (selected) document.getElementById('day-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selected]);

  if (!log) return error ? <Alert>{error}</Alert> : loading ? <p className="muted">{t('loading')}</p> : null;

  const returned = log.status === 'RETURNED_TO_PROVIDER' ? latestReturn(log) : null;
  const entry = selected ? log.entries.find((e) => e.entry_date === selected) : undefined;

  return (
    <div className="stack-lg">
      <div className="row-between">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          ← {t('back')}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate('print', log.id)}>
          {t('print')}
        </button>
      </div>
      <header className="stack">
        <h1>{log.cadre.form_title || log.cadre.name}</h1>
        <ApprovalStepper status={log.status} audit={log.audit} hoursInStatus={log.hours_in_status} facilityEndorsed={log.endorsements.find((e) => e.version === log.version && e.kind === 'FACILITY_IN_CHARGE')?.actor_name} technicalReviewer={log.cadre?.technical_reviewer_title} />
        {log.status !== 'RETURNED_TO_PROVIDER' && log.review_feedback?.map((feedback, index) =>
          feedback.comment ? <Alert kind="warn" key={index}>{feedback.comment}</Alert> : null)}
        <div className="row">
          <span className="muted">
            {log.period_label} · #{log.id}
          </span>
          <StatusBadge kind="log" status={log.status} />
          {log.claims.map((c) => (
            <span key={c.id} className="badges">
              <StatusBadge kind="claim" status={c.status} />
              <StatusBadge kind="payment" status={c.payment_status} />
            </span>
          ))}
        </div>
        {log.status === 'APPROVED' && <p className="muted small">{t('approvedNotPaid')}</p>}
      </header>

      {returned && (
        <div className="alert alert-warn" role="status">
          <strong>{t('returnedTitle')}</strong>
          {returned.comment && (
            <p style={{ margin: '0.3rem 0 0' }}>
              {t('reviewerSays')} ({returned.actor_name || '—'}): “{returned.comment}”
            </p>
          )}
          <FlagsList flags={flags} cadre={log.cadre} lang={lang} />
        </div>
      )}

      {me?.client_settings.provider_otp_required !== false && log.awaiting_my_otp && <OtpPanel log={log} onChanged={setData} />}

      {log.work_type !== 'PAYROLL' && <PayoutEstimate logId={log.id} version={log.updated_at} />}

      <HeaderForm key={`${log.id}-${log.updated_at}`} log={log} onSaved={setData} />

      <DayCalendar log={log} selected={selected} flaggedDates={flaggedDates} onSelect={setSelected} />

      {selected && log.can_edit && (
        <DayEntryForm
          key={`${selected}-${entry?.id ?? 'new'}`}
          log={log}
          date={selected}
          entry={entry}
          flags={flags}
          captureOnEntry={captureOnEntry}
          onSaved={(l) => {
            setData(l);
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      )}

      {log.entries.length > 0 && (!log.can_edit || !selected) && (
        <section className="card stack">
          <h3>{t('dailyEntries')}</h3>
          <EntriesView log={log} lang={lang} flags={flags} />
        </section>
      )}

      <TotalsPanel log={log} lang={lang} title={t('totals')} />

      {log.can_edit && <SubmitPanel log={log} onSubmitted={setData} />}

      {log.available_actions.includes('cancel') && (
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={() => setCancelling(true)}>
            {t('cancelLog')}
          </button>
        </div>
      )}
      {cancelling && (
        <ReasonDialog
          title={t('cancelLog')}
          required={false}
          danger
          confirmLabel={t('cancelLog')}
          onConfirm={async (comment) => {
            setData(await api.post<WorkLogDetail>(`/worklogs/${log.id}/actions/cancel`, { comment: comment || null, expected_version: log.version }));
            setCancelling(false);
          }}
          onClose={() => setCancelling(false)}
        />
      )}

      <AdminAudit><details className="card">
        <summary>{t('history')}</summary>
        <div style={{ marginTop: '0.75rem' }}>
          <AuditTimeline rows={log.audit.filter((a) => a.action !== 'opened')} actionLabels={WORKLOG_ACTION_LABELS} statusKind="log" />
        </div>
      </details></AdminAudit>
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}>
          ↻ {t('reload')}
        </button>
      </div>
    </div>
  );
}
