import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/ui';
import { dateOnly, dateTime, datesBetween, dayOfMonth, num, payMonth, payMonthDates, periodDateError, timeShort, weekday, workHours } from '../format';
import { useApi } from '../hooks';
import { navigate } from '../nav';
import { WorkLogAudit, WorkLogDetail, WorkLogEntry } from '../types';

// Statuses a log only reaches once that stage is finished. Audit rows are for administrators only, so other
// reviewers see from the current status that a stage is complete, without the signer's name or date.
const AFTER_RM = ['PENDING_FINANCE_REVIEW', 'FINANCE_REVIEWED', 'ROUTED_FHI360', 'ROUTED_CSO', 'PAID', 'APPROVED', 'BUDGET_HOLD'];
const AFTER_TECHNICAL = ['PENDING_RPM_AUTHORIZATION', ...AFTER_RM];
const AFTER_OTP = ['PENDING_TECHNICAL_REVIEW', ...AFTER_TECHNICAL];
const AFTER_CTC = ['PENDING_PROVIDER_OTP_CONFIRMATION', ...AFTER_OTP];

/** Everything recorded on one date: the main activity plus any additional services, as the server totals count them. */
function dayValues(entry?: WorkLogEntry): Record<string, number> {
  const values: Record<string, number> = {};
  const add = (measures: Record<string, number | boolean>) => Object.entries(measures).forEach(([key, value]) => {
    if (value !== null && value !== undefined) values[key] = (values[key] || 0) + Number(value);
  });
  if (entry) {
    add(entry.measures);
    entry.activity_snapshot?.additional_services?.forEach((service) => add(service.measures));
  }
  return values;
}

/** Latest occurrence of `action` since the most recent submission (earlier sign-offs were superseded). */
function signOff(log: WorkLogDetail, action: string): WorkLogAudit | null {
  let lastSubmit = -1;
  log.audit.forEach((a, i) => {
    if (a.action === 'submit') lastSubmit = i;
  });
  const rows = log.audit.filter((a, i) => a.action === action && i > lastSubmit);
  return rows.length ? rows[rows.length - 1] : null;
}

function SignBox({ titleSw, titleEn, row, name, at, done = false }: { titleSw: string; titleEn: string; row?: WorkLogAudit | null; name?: string | null; at?: string | null; done?: boolean }) {
  const who = name ?? row?.actor_name ?? null;
  const when = at ?? row?.timestamp ?? null;
  return (
    <div>
      <div>
        <b>{titleSw}</b> / <i>{titleEn}</i>
      </div>
      {who || when ? (
        <>
          <div className="who">{who || '—'}</div>
          <div>{dateTime(when)}</div>
          {row?.comment && <div>“{row.comment}”</div>}
        </>
      ) : done ? (
        <div className="who">Imekamilika / Completed</div>
      ) : (
        <div>—</div>
      )}
    </div>
  );
}

/** Print-optimised mirror of the paper work-log form: dates as columns, rows for hours and each form field. */
export function PrintWorkLog({ logId, reviewLog, embedded = false, onReady }: { logId: number; reviewLog?: WorkLogDetail; embedded?: boolean; onReady?: () => void }) {
  const { me } = useAuth();
  const validId = Number.isSafeInteger(logId) && logId > 0;
  const { data, error, loading, reload } = useApi<WorkLogDetail>(validId && !reviewLog ? `/worklogs/${logId}` : null, { timeoutMs: 20000 });
  const log = reviewLog || data;
  const [selectedMonth, setSelectedMonth] = useState('');
  const dateError = log ? periodDateError(log.period.start_date, log.period.end_date) : null;
  React.useEffect(() => {
    if (log && log.id === logId && !dateError && !error && (reviewLog || !loading)) onReady?.();
  }, [log, logId, dateError, error, loading, reviewLog, onReady]);
  const allDates = log ? datesBetween(log.period.start_date, log.period.end_date) : [];
  const months = Array.from(new Set(allDates.map(payMonth)));
  const firstWorkedMonth = months.find(value => log?.entries.some(entry => payMonth(entry.entry_date) === value));
  const month = months.includes(selectedMonth) ? selectedMonth : firstWorkedMonth || months[0];
  const monthLabel = (value: string) => new Intl.DateTimeFormat('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}-01T00:00:00Z`));

  const monthLabelText = embedded ? 'Month' : 'Print month';
  const toolbar = !embedded || months.length > 1 || error ? (
    <div className="print-toolbar no-print">
      {!embedded && <button className="btn btn-ghost btn-sm" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('home'))}>
        ← Back
      </button>}
      {!embedded && <button className="btn btn-primary btn-sm" onClick={() => window.print()} disabled={!log || !!dateError}>
        Print
      </button>}
      {log && !dateError && (!embedded || months.length > 1) && <label className="row">
        {monthLabelText}
        <select aria-label={monthLabelText} value={month} onChange={event => setSelectedMonth(event.target.value)}>
          {months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}
        </select>
      </label>}
      {error && <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>Retry</button>}
      {embedded
        ? months.length > 1 && <span className="muted small">This timesheet covers {months.length} months. Check each one.</span>
        : <span className="muted small">Landscape A4 is recommended.</span>}
    </div>
  ) : null;

  if (!log)
    return (
      <div>
        {toolbar}
        {!validId ? <Alert>Invalid work-log number. Open Print view from a work log.</Alert>
          : error ? <Alert>{error}</Alert> : loading ? <p className="muted">Loading…</p>
          : <Alert>The work log could not be loaded. Open it again from your work-log list.</Alert>}
      </div>
    );

  if (dateError) return <div>{toolbar}<Alert>{dateError} Contact an administrator to correct the pay period before printing.</Alert></div>;

  const dates = allDates.filter(date => payMonth(date) === month);
  const holidays = (log.period.holidays || []).filter(day => dates.includes(day.date));
  const holidayDates = new Set(holidays.map(day => day.date));
  const holidayClass = (d: string) => (holidayDates.has(d) ? 'holiday' : undefined);
  const entries = log.entries.filter(entry => dates.includes(entry.entry_date));
  const byDate = new Map(entries.map((e) => [e.entry_date, e]));
  const measureTotal = (key: string) => entries.reduce((sum, entry) => sum + (dayValues(entry)[key] || 0), 0);
  const additional = (d: string) => byDate.get(d)?.activity_snapshot?.additional_services || [];
  const direct = log.cadre.hours_mode === 'DIRECT';
  const a = log.assignment;
  const comments = entries.filter((e) => e.comment);

  const rows: { key: string; sw: string; en: string; cell: (d: string) => string; total: string }[] = [];
  if (!direct) {
    rows.push({ key: 'start', sw: 'Muda wa kuanza', en: 'Start time', cell: (d) => (byDate.get(d)?.start_time ? timeShort(byDate.get(d)?.start_time) : ''), total: '' });
    rows.push({ key: 'end', sw: 'Muda wa kumaliza', en: 'End time', cell: (d) => (byDate.get(d)?.end_time ? timeShort(byDate.get(d)?.end_time) : ''), total: '' });
  }
  rows.push({
    key: 'activity',
    sw: 'Aina ya shughuli',
    en: 'Activity',
    cell: (d) => [
      log.cadre.activities?.find((activity) => activity.key === byDate.get(d)?.activity_key)?.label_en,
      ...additional(d).map((service) => service.activity.label_en),
    ].filter(Boolean).join(' + '),
    total: '',
  });
  rows.push({
    key: 'location',
    sw: 'Kituo kingine',
    en: 'Secondary facility',
    cell: (d) => Array.from(new Set([byDate.get(d)?.activity_location, ...additional(d).map((service) => service.activity_location)].filter(Boolean))).join(' + '),
    total: '',
  });
  rows.push({
    key: 'hours',
    sw: 'Masaa uliyofanya kazi',
    en: 'Hours worked',
    cell: (d) => (byDate.has(d) ? workHours(byDate.get(d)?.hours_worked) : ''),
    total: workHours(entries.reduce((sum, entry) => sum + Number(entry.hours_worked || 0), 0)),
  });
  log.cadre.fields.forEach((f) => {
    rows.push({
      key: f.key,
      sw: f.label_sw || f.label_en,
      en: f.label_en,
      cell: (d) => {
        const v = dayValues(byDate.get(d))[f.key];
        if (v === undefined) return '';
        return f.field_type === 'BOOLEAN' ? (Number(v) ? 'Ndiyo' : 'Hapana') : num(v);
      },
      total: f.field_type === 'BOOLEAN' ? `${num(measureTotal(f.key))} Ndiyo` : num(measureTotal(f.key)),
    });
  });

  const header: [string, string, React.ReactNode][] = [
    ['Mkoa', 'Region', a?.region],
    ['Wilaya', 'District', a?.district],
    ['Kata', 'Ward', a?.ward],
    ['Kituo', 'Facility', a?.facility || a?.community_area],
    ['Jina la kwanza', 'First name', log.staff.first_name],
    ['Jina la kati', 'Middle name', log.staff.middle_name],
    ['Jina la ukoo', 'Surname', log.staff.last_name],
    ['Kada', 'Occupation', log.occupation ? `${log.occupation}${log.occupation_other ? ` – ${log.occupation_other}` : ''}` : log.cadre.name],
    ['Idara', 'Section', log.section],
    ['Ngazi ya mshahara', 'Salary scale', log.staff.salary_scale],
    ['Mwanzo wa kipindi', 'Period start', dateOnly(log.period.start_date)],
    ['Mwisho wa kipindi', 'Period end', dateOnly(log.period.end_date)],
  ];

  return (
    <div>
      {toolbar}
      <article className="paper" aria-label={embedded ? 'Timesheet' : 'Printable work log'}>
        <h1>{log.cadre.form_title || log.cadre.name}</h1>
        <h2>{monthLabel(month)} · {payMonthDates(month)}</h2>
        <div className="paper-header">
          {header.map(([sw, en, v]) => (
            <div key={en}>
              <b>{sw}</b> / {en}: {v || '—'}
            </div>
          ))}
        </div>
        <div className="paper-table">
        <table>
          <thead>
            <tr>
              <th>Tarehe / Date</th>
              {dates.map((d) => (
                <th key={d} title={d} className={holidayClass(d)}>
                  {dayOfMonth(d)}
                  <br />
                  {weekday(d, 'sw')}
                </th>
              ))}
              <th>JUMLA<br />TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="rowlabel">
                  <span className="sw">{r.sw}</span>
                  {r.sw !== r.en && <span className="en">{r.en}</span>}
                </td>
                {dates.map((d) => (
                  <td key={d} className={holidayClass(d)}>{r.cell(d)}</td>
                ))}
                <td className="total">{r.total}</td>
              </tr>
            ))}
            <tr>
              <td className="rowlabel">
                <span className="sw">Siku za kazi</span>
                <span className="en">Days worked</span>
              </td>
              {dates.map((d) => (
                <td key={d} className={holidayClass(d)}>{byDate.has(d) ? '✓' : ''}</td>
              ))}
              <td className="total">{num(entries.length)}</td>
            </tr>
            {holidays.length > 0 && <tr>
              <td className="rowlabel">
                <span className="sw">Sikukuu</span>
                <span className="en">Public holiday</span>
              </td>
              {dates.map((d) => (
                <td key={d} className={holidayClass(d)}>{holidayDates.has(d) ? 'S' : ''}</td>
              ))}
              <td className="total">{num(holidays.length)}</td>
            </tr>}
          </tbody>
        </table>
        </div>
        {holidays.length > 0 && <div className="paper-comments">
          <b>SIKUKUU / Public holidays:</b> {holidays.map(day => `${dateOnly(day.date)} ${day.name_sw} / ${day.name_en}`).join(' · ')}
        </div>}
        {log.status !== 'DRAFT' && !!log.service_targets?.some(row => row.left) && <div className="paper-comments">
          <b>SIKU CHINI YA KIWANGO / Below minimum service days:</b>{' '}
          {log.service_targets.filter(row => row.left).map(row => `${row.service}: ${num(row.days)} of ${num(row.min_days)} days, ${num(row.left)} short`).join(' · ')}.
          {' '}Payment is not affected.
        </div>}
        <div className="paper-comments">
          {(log.period_comment || !['CHW', 'HCP', 'DATA_CLERK'].includes(log.cadre.code)) && <><b>MAONI / Comments:</b> {log.period_comment || ''}</>}
          {comments.map((e) => (
            <div key={e.id}>
              {dateOnly(e.entry_date)}: {e.comment}
            </div>
          ))}
        </div>
        <div className="signoff">
          <SignBox titleSw="Imeandaliwa na kuthibitishwa na" titleEn="Prepared and attested by provider" name={log.staff.name} at={log.attested_at} />
          <SignBox titleSw={a && !a.facility ? 'Idhini ya kitaalamu ya CSO' : 'Uhakiki wa CTC'} titleEn={a && !a.facility ? 'CSO Technical approval' : 'CTC verification'} row={signOff(log, 'verify')} done={AFTER_CTC.includes(log.status)} />
          {(me?.client_settings.provider_otp_required !== false || !!signOff(log, 'confirm_otp')) && (
            <SignBox
              titleSw="Uthibitisho wa mtoa huduma"
              titleEn={me?.client_settings.provider_otp_required === false ? 'Historical provider confirmation' : 'Provider confirmation (SMS code)'}
              row={signOff(log, 'confirm_otp')}
              done={AFTER_OTP.includes(log.status)}
            />
          )}
          {log.cadre.requires_facility_endorsement && (
            <SignBox titleSw="Mfawidhi wa kituo" titleEn="Facility in-charge endorsement" row={signOff(log, 'facility_endorse')} />
          )}
          <SignBox titleSw="Mapitio ya kitaalamu" titleEn="Technical review" row={signOff(log, 'endorse')} done={AFTER_TECHNICAL.includes(log.status)} />
          <SignBox titleSw="Idhini ya RM" titleEn="RM approval" row={signOff(log, 'authorize')} done={AFTER_RM.includes(log.status)} />
        </div>
        <p style={{ marginTop: '0.5rem' }}>
          Work log #{log.id} · version {log.version} · status {log.status} · printed {dateTime(new Date().toISOString())}. Approval is not payment.
        </p>
      </article>
    </div>
  );
}
