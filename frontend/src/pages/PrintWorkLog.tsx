import React from 'react';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/ui';
import { dateOnly, dateTime, datesBetween, dayOfMonth, num, timeShort, weekday } from '../format';
import { useApi } from '../hooks';
import { WorkLogAudit, WorkLogDetail } from '../types';

/** Latest occurrence of `action` since the most recent submission (earlier sign-offs were superseded). */
function signOff(log: WorkLogDetail, action: string): WorkLogAudit | null {
  let lastSubmit = -1;
  log.audit.forEach((a, i) => {
    if (a.action === 'submit') lastSubmit = i;
  });
  const rows = log.audit.filter((a, i) => a.action === action && i > lastSubmit);
  return rows.length ? rows[rows.length - 1] : null;
}

function SignBox({ titleSw, titleEn, row, name, at }: { titleSw: string; titleEn: string; row?: WorkLogAudit | null; name?: string | null; at?: string | null }) {
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
      ) : (
        <div>—</div>
      )}
    </div>
  );
}

/** Print-optimised mirror of the paper work-log form: dates as columns, rows for hours and each form field. */
export function PrintWorkLog({ logId }: { logId: number }) {
  const { data: log, error, loading } = useApi<WorkLogDetail>(`/worklogs/${logId}`);
  const { me } = useAuth();
  const otpRequired = me?.client_settings.provider_otp_required !== false;

  const toolbar = (
    <div className="print-toolbar no-print">
      <button className="btn btn-ghost btn-sm" onClick={() => window.history.back()}>
        ← Back
      </button>
      <button className="btn btn-primary btn-sm" onClick={() => window.print()} disabled={!log}>
        Print
      </button>
      <span className="muted small">Landscape A4 is recommended.</span>
    </div>
  );

  if (!log)
    return (
      <div>
        {toolbar}
        {error ? <Alert>{error}</Alert> : loading ? <p className="muted">Loading…</p> : null}
      </div>
    );

  const dates = datesBetween(log.period.start_date, log.period.end_date);
  const byDate = new Map(log.entries.map((e) => [e.entry_date, e]));
  const direct = log.cadre.hours_mode === 'DIRECT';
  const a = log.assignment;
  const comments = log.entries.filter((e) => e.comment);

  const rows: { sw: string; en: string; cell: (d: string) => string; total: string }[] = [];
  if (!direct) {
    rows.push({ sw: 'Muda wa kuanza', en: 'Start time', cell: (d) => (byDate.get(d)?.start_time ? timeShort(byDate.get(d)?.start_time) : ''), total: '' });
    rows.push({ sw: 'Muda wa kumaliza', en: 'End time', cell: (d) => (byDate.get(d)?.end_time ? timeShort(byDate.get(d)?.end_time) : ''), total: '' });
  }
  rows.push({
    sw: 'Masaa uliyofanya kazi',
    en: 'Hours worked',
    cell: (d) => (byDate.has(d) ? num(byDate.get(d)?.hours_worked) : ''),
    total: num(log.totals.hours),
  });
  log.cadre.fields.forEach((f) => {
    rows.push({
      sw: f.label_sw || f.label_en,
      en: f.label_en,
      cell: (d) => {
        const v = byDate.get(d)?.measures[f.key];
        if (v === undefined || v === null) return '';
        return f.field_type === 'BOOLEAN' ? (Number(v) ? 'Ndiyo' : 'Hapana') : num(v);
      },
      total: f.field_type === 'BOOLEAN' ? `${num(log.totals.measures[f.key] ?? 0)} Ndiyo` : num(log.totals.measures[f.key] ?? 0),
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
      <article className="paper" aria-label="Printable work log">
        <h1>{log.cadre.form_title || log.cadre.name}</h1>
        <div className="paper-header">
          {header.map(([sw, en, v]) => (
            <div key={en}>
              <b>{sw}</b> / {en}: {v || '—'}
            </div>
          ))}
        </div>
        <table>
          <thead>
            <tr>
              <th>Tarehe / Date</th>
              {dates.map((d) => (
                <th key={d} title={d}>
                  {dayOfMonth(d)}
                  <br />
                  {weekday(d, 'sw')}
                </th>
              ))}
              <th>JUMLA / TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.en}>
                <td className="rowlabel">
                  <span className="sw">{r.sw}</span>
                  {r.sw !== r.en && <span className="en">{r.en}</span>}
                </td>
                {dates.map((d) => (
                  <td key={d}>{r.cell(d)}</td>
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
                <td key={d}>{byDate.has(d) ? '✓' : ''}</td>
              ))}
              <td className="total">{num(log.totals.days)}</td>
            </tr>
          </tbody>
        </table>
        <div className="paper-comments">
          <b>MAONI / Comments:</b> {log.period_comment || ''}
          {comments.map((e) => (
            <div key={e.id}>
              {dateOnly(e.entry_date)}: {e.comment}
            </div>
          ))}
        </div>
        <div className="signoff">
          <SignBox titleSw="Imeandaliwa na kuthibitishwa na" titleEn="Prepared and attested by provider" name={log.staff.name} at={log.attested_at} />
          <SignBox titleSw="Uhakiki wa CTC" titleEn="CTC verification" row={signOff(log, 'verify')} />
          {(otpRequired || signOff(log, 'confirm_otp')) && (
            <SignBox titleSw="Uthibitisho wa mtoa huduma (SMS)" titleEn="Provider confirmation (SMS code)" row={signOff(log, 'confirm_otp')} />
          )}
          {log.cadre.requires_facility_endorsement && (
            <SignBox titleSw="Mfawidhi wa kituo" titleEn="Facility in-charge endorsement" row={signOff(log, 'facility_endorse')} />
          )}
          <SignBox titleSw="Mapitio ya kitaalamu" titleEn="Technical review" row={signOff(log, 'endorse')} />
          <SignBox titleSw="Idhini ya RPM" titleEn="RPM approval" row={signOff(log, 'authorize')} />
        </div>
        <p style={{ marginTop: '0.5rem' }}>
          Work log #{log.id} · version {log.version} · status {log.status} · printed {dateTime(new Date().toISOString())}. Approval is not payment.
        </p>
      </article>
    </div>
  );
}
