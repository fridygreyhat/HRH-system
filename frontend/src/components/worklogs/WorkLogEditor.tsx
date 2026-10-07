import { ApprovalStepper } from './ApprovalStepper';
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { datesBetween, dayOfMonth, num, todayLocal, WORKLOG_ACTION_LABELS, weekday } from '../../format';
import { useAction, useApi } from '../../hooks';
import { navigate } from '../../nav';
import { Section as SectionRow, WorkLogDetail } from '../../types';
import { Alert, AuditTimeline, Field, ReasonDialog, StatusBadge } from '../ui';
import { captureLocation, DayEntryForm } from './DayEntryForm';
import { OtpPanel } from './OtpPanel';
import { EntriesView, FlagsList, latestReturn, returnFlags, TotalsPanel } from './shared';

const WEEK_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_SW = ['Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijm', 'Jms', 'Jpl'];

function HeaderForm({ log, onSaved }: { log: WorkLogDetail; onSaved: (l: WorkLogDetail) => void }) {
  const { t } = useAuth();
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
    const body: Record<string, string | null> = { period_comment: comment.trim() || null };
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
      <Field label={t('periodComment')}>
        <textarea rows={2} maxLength={2000} disabled={!log.can_edit} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
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

/** Mobile-first day picker for the period: tap a day to open its entry form. */
function DayCalendar({
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
  const dates = datesBetween(log.period.start_date, log.period.end_date);
  const byDate = new Map(log.entries.map((e) => [e.entry_date, e]));
  // Monday-first grid: pad the first week.
  const firstDow = (new Date(`${dates[0]}T00:00:00Z`).getUTCDay() + 6) % 7;
  return (
    <section className="card stack" aria-labelledby="cal-title">
      <div className="row-between">
        <h3 id="cal-title">{t('calendar')}</h3>
        <span className="muted small">
          {num(log.entries.length)} {t('days').toLowerCase()} · {num(log.totals.hours)} {t('hours').toLowerCase()}
        </span>
      </div>
      <p className="muted small">{log.can_edit ? t('calendarHint') : t('locked')}</p>
      <div className="calendar" role="grid" aria-label={t('calendar')}>
        {(lang === 'sw' ? WEEK_SW : WEEK_EN).map((d) => (
          <div key={d} className="calendar-head" role="columnheader">
            {d}
          </div>
        ))}
        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden />
        ))}
        {dates.map((d) => {
          const entry = byDate.get(d);
          const future = d > today;
          const disabled = future || (!log.can_edit && !entry);
          const classes = ['day', entry ? 'has-entry' : '', flaggedDates.has(d) ? 'is-flagged' : '', selected === d ? 'is-selected' : ''].filter(Boolean).join(' ');
          const state = future ? t('future') : flaggedDates.has(d) ? t('flagged') : entry ? `${t('recorded')}: ${num(entry.hours_worked)} h` : '';
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
  const gpsOnSubmit = !!me?.client_settings.gps_capture_events.includes('SUBMIT');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await run(async () => {
      const fix = gpsOnSubmit ? await captureLocation() : null;
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
      {gpsOnSubmit && <span className="field-hint">{t('gpsHint')}</span>}
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={!attest || busy || log.entries.length === 0}>
          {busy ? t('submitting') : t('submit')}
        </button>
      </div>
    </form>
  );
}

/** Provider work-log editor: header, day-by-day entries, totals, submission, OTP confirmation. */
export function WorkLogEditor({ logId, onBack }: { logId: number; onBack: () => void }) {
  const { me, t, lang } = useAuth();
  const { data: log, error, loading, setData, reload } = useApi<WorkLogDetail>(`/worklogs/${logId}`);
  const [selected, setSelected] = useState<string | null>(null);
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
        <ApprovalStepper status={log.status} audit={log.audit} hoursInStatus={log.hours_in_status} facilityEndorsed={log.endorsements.find((e) => e.version === log.version && e.kind === 'FACILITY_IN_CHARGE')?.actor_name} />
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

      {log.awaiting_my_otp && <OtpPanel log={log} onChanged={setData} />}

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

      <details className="card">
        <summary>{t('history')}</summary>
        <div style={{ marginTop: '0.75rem' }}>
          <AuditTimeline rows={log.audit.filter((a) => a.action !== 'opened')} actionLabels={WORKLOG_ACTION_LABELS} statusKind="log" />
        </div>
      </details>
      <div className="row">
        <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}>
          ↻ {t('reload')}
        </button>
      </div>
    </div>
  );
}
