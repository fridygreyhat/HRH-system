import React from 'react';
import { bilingual } from '../../i18n';
import { dateOnly, num, timeShort, weekday } from '../../format';
import { Cadre, CadreField, Lang, ReturnFlag, WorkLogAudit, WorkLogDetail, WorkLogEntry } from '../../types';
import { LocationBadge } from '../ui';

export const FLAG_GENERAL_FIELDS: { key: string; en: string; sw: string }[] = [
  { key: 'hours', en: 'Hours / times', sw: 'Masaa / muda' },
  { key: 'evidence', en: 'Evidence', sw: 'Ushahidi' },
  { key: 'location', en: 'Location', sw: 'Mahali' },
  { key: 'comment', en: 'Comment', sw: 'Maoni' },
];

/** Label of a cadre form field: primary language first, the other beneath. */
export function FieldLabel({ field, lang }: { field: Pick<CadreField, 'label_en' | 'label_sw'>; lang: Lang }) {
  const { primary, secondary } = bilingual(lang, field.label_en, field.label_sw);
  return (
    <span className="bi-label">
      <span>{primary}</span>
      {secondary && <span className="bi-secondary">{secondary}</span>}
    </span>
  );
}

export function flagFieldLabel(cadre: Cadre, key: string, lang: Lang = 'en'): string {
  const general = FLAG_GENERAL_FIELDS.find((f) => f.key === key);
  if (general) return lang === 'sw' ? general.sw : general.en;
  const field = cadre.fields.find((f) => f.key === key);
  if (!field) return key;
  return lang === 'sw' && field.label_sw ? field.label_sw : field.label_en;
}

/** The most recent audit row that sent the log back to the provider (return / reopen / decline). */
export function latestReturn(log: WorkLogDetail): WorkLogAudit | null {
  const rows = log.audit.filter((a) => a.new_status === 'RETURNED_TO_PROVIDER' && a.old_status !== 'RETURNED_TO_PROVIDER');
  return rows.length ? rows[rows.length - 1] : null;
}

export function returnFlags(log: WorkLogDetail): ReturnFlag[] {
  if (log.status !== 'RETURNED_TO_PROVIDER') return [];
  const row = latestReturn(log);
  const flags = row?.details?.flags;
  return Array.isArray(flags) ? flags : [];
}

export function measureValue(field: CadreField, value: number | undefined, lang: Lang = 'en'): string {
  if (value === undefined || value === null) return '—';
  if (field.field_type === 'BOOLEAN') return Number(value) ? (lang === 'sw' ? 'Ndiyo' : 'Yes') : lang === 'sw' ? 'Hapana' : 'No';
  return num(value);
}

function Coordinates({ entry }: { entry: WorkLogEntry }) {
  // Coordinates are only present when the server decided this user may see them.
  if (entry.gps_lat === undefined || entry.gps_lat === null || entry.gps_lon === undefined || entry.gps_lon === null) return null;
  return (
    <div className="muted small">
      {Number(entry.gps_lat).toFixed(5)}, {Number(entry.gps_lon).toFixed(5)}
      {entry.gps_accuracy_m ? ` (±${Math.round(Number(entry.gps_accuracy_m))} m)` : ''}
    </div>
  );
}

const isFlagged = (flags: ReturnFlag[], date: string, field?: string) => flags.some((f) => f.entry_date === date && (!field || f.field === field));

/** Daily entries: a table on wide screens, cards on phones. Flagged dates/fields are highlighted. */
export function EntriesView({ log, lang, flags = [] }: { log: WorkLogDetail; lang: Lang; flags?: ReturnFlag[] }) {
  const { cadre, entries } = log;
  const suppressEmptyEvidence = cadre.code === 'HCP' || cadre.code === 'CHW' || cadre.code === 'DATA_CLERK';
  const showEvidence = !suppressEmptyEvidence || entries.some((entry) => Boolean(entry.evidence_text?.trim() || entry.comment?.trim()));
  const startEnd = cadre.hours_mode !== 'DIRECT';
  const activityFor = (key: string | null) => cadre.activities?.find((activity) => activity.key === key);
  const fieldsFor = (key: string | null) => {
    const activity = activityFor(key);
    return activity ? activity.fields.flatMap((fieldKey) => cadre.fields.filter((field) => field.key === fieldKey)) : cadre.fields;
  };
  if (!entries.length) return <p className="muted">No daily entries.</p>;
  return (
    <>
      <div className="table-wrap entries-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              {startEnd && <th>Start–end</th>}
              <th className="num">Hours</th>
              <th>Activity and indicators</th>
              {showEvidence && <th>Evidence / comment</th>}
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className={isFlagged(flags, e.entry_date) ? 'flagged' : undefined}>
                <td className="nowrap">
                  {weekday(e.entry_date, lang)} {dateOnly(e.entry_date)}
                </td>
                {startEnd && (
                  <td className={`nowrap${isFlagged(flags, e.entry_date, 'hours') ? ' flagged' : ''}`}>
                    {timeShort(e.start_time)}–{timeShort(e.end_time)}
                  </td>
                )}
                <td className={`num${isFlagged(flags, e.entry_date, 'hours') ? ' flagged' : ''}`}>{num(e.hours_worked)}</td>
                <td>
                  <strong>{activityFor(e.activity_key)?.[lang === 'sw' ? 'label_sw' : 'label_en'] || '—'}</strong>
                  {(e.activity_snapshot?.additional_services || []).map(service => <div key={service.activity.key} className="small">
                    <strong>+ {service.activity[lang === 'sw' ? 'label_sw' : 'label_en']}</strong>
                    {Object.entries(service.measures).map(([key, value]) => <div key={key}>{log.cadre.fields.find(field => field.key === key)?.[lang === 'sw' ? 'label_sw' : 'label_en'] || key}: {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}</div>)}
                  </div>)}
                   {(() => {
                     const activity = activityFor(e.activity_key);
                     const visible = fieldsFor(e.activity_key).filter((field) => e.measures[field.key] !== undefined);
                     const groups = activity?.groups?.map((group) => ({
                       group,
                       fields: visible.filter((field) => group.fields.includes(field.key)),
                     })).filter(({ fields }) => fields.length) || [];
                     const groupedKeys = new Set(groups.flatMap(({ fields }) => fields.map((field) => field.key)));
                     const ungrouped = visible.filter((field) => !groupedKeys.has(field.key));
                     return (
                       <ul className="small entry-indicators" style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
                         {groups.flatMap(({ group, fields }) => [
                           <li key={`group-${group.key}`} className="entry-indicator-group">{lang === 'sw' ? group.label_sw : group.label_en}</li>,
                           ...fields.map((field) => (
                             <li key={field.key} className={isFlagged(flags, e.entry_date, field.key) ? 'flagged' : undefined}>
                               {lang === 'sw' ? field.label_sw : field.label_en}: {measureValue(field, e.measures[field.key], lang)}
                             </li>
                           )),
                         ])}
                         {ungrouped.map((field) => (
                           <li key={field.key} className={isFlagged(flags, e.entry_date, field.key) ? 'flagged' : undefined}>
                             {lang === 'sw' ? field.label_sw : field.label_en}: {measureValue(field, e.measures[field.key], lang)}
                           </li>
                         ))}
                       </ul>
                     );
                   })()}
                </td>
                {showEvidence && <td className={isFlagged(flags, e.entry_date, 'evidence') ? 'flagged' : undefined}>
                  {e.evidence_text?.trim() && e.evidence_text}
                  {e.comment?.trim() && <div className="muted small">{e.comment}</div>}
                </td>}
                <td className={isFlagged(flags, e.entry_date, 'location') ? 'flagged' : undefined}>
                  <LocationBadge status={e.location_status} />
                  <Coordinates entry={e} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="entry-cards">
        {entries.map((e) => (
          <article key={e.id} className={`entry-card${isFlagged(flags, e.entry_date) ? ' flagged-field' : ''}`}>
            <div className="row-between">
              <strong>
                {weekday(e.entry_date, lang)} {dateOnly(e.entry_date)}
              </strong>
              <LocationBadge status={e.location_status} />
            </div>
            <Coordinates entry={e} />
            <dl>
              <dt>Hours{startEnd ? ` (${timeShort(e.start_time)}–${timeShort(e.end_time)})` : ''}</dt>
              <dd className={isFlagged(flags, e.entry_date, 'hours') ? 'flagged-field' : undefined}>{num(e.hours_worked)}</dd>
              {activityFor(e.activity_key) && (
                <>
                  <dt>Activity</dt>
                  <dd>{activityFor(e.activity_key)?.[lang === 'sw' ? 'label_sw' : 'label_en']}</dd>
                  {(e.activity_snapshot?.additional_services || []).map(service => <React.Fragment key={service.activity.key}>
                    <dt>Additional service</dt><dd><strong>{service.activity[lang === 'sw' ? 'label_sw' : 'label_en']}</strong>
                      {Object.entries(service.measures).map(([key, value]) => <div key={key}>{log.cadre.fields.find(field => field.key === key)?.[lang === 'sw' ? 'label_sw' : 'label_en'] || key}: {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}</div>)}
                    </dd>
                  </React.Fragment>)}
                </>
              )}
              {fieldsFor(e.activity_key).map((f) => (
                <React.Fragment key={f.key}>
                  <dt><FieldLabel field={f} lang={lang} /></dt>
                  <dd className={isFlagged(flags, e.entry_date, f.key) ? 'flagged-field' : undefined}>{measureValue(f, e.measures[f.key], lang)}</dd>
                </React.Fragment>
              ))}
            </dl>
            {(!suppressEmptyEvidence || e.evidence_text?.trim()) && e.evidence_text?.trim() && <div className={isFlagged(flags, e.entry_date, 'evidence') ? 'flagged-field small' : 'small'}>{e.evidence_text}</div>}
            {e.comment?.trim() && <div className="muted small">{e.comment}</div>}
          </article>
        ))}
      </div>
    </>
  );
}

/** Server-computed totals. */
export function TotalsPanel({ log, lang, title }: { log: WorkLogDetail; lang: Lang; title: string }) {
  return (
    <section className="card stack" aria-label={title}>
      <h3>{title}</h3>
      <dl className="totals-list">
        <div>
          <dt>{lang === 'sw' ? 'Siku za kazi / Days worked' : 'Days worked / Siku za kazi'}</dt>
          <dd>{num(log.totals.days)}</dd>
        </div>
        <div>
          <dt>{lang === 'sw' ? 'Masaa / Hours' : 'Hours / Masaa'}</dt>
          <dd>{num(log.totals.hours)}</dd>
        </div>
        {log.cadre.fields.filter((f) => Number(log.totals.measures[f.key] ?? 0) > 0).map((f) => (
          <div key={f.key}>
            <dt>
              <FieldLabel field={f} lang={lang} />
            </dt>
            <dd>{f.field_type === 'BOOLEAN' ? `${num(log.totals.measures[f.key] ?? 0)} × ${lang === 'sw' ? 'Ndiyo' : 'Yes'}` : num(log.totals.measures[f.key] ?? 0)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function FlagsList({ flags, cadre, lang }: { flags: ReturnFlag[]; cadre: Cadre; lang: Lang }) {
  if (!flags.length) return null;
  return (
    <ul className="small" style={{ margin: '0.3rem 0 0', paddingLeft: '1.2rem' }}>
      {flags.map((f, i) => (
        <li key={`${f.entry_date}-${f.field}-${i}`}>
          <strong>
            {f.entry_date ? dateOnly(f.entry_date) : '—'} · {flagFieldLabel(cadre, f.field, lang)}
          </strong>
          {f.note ? `: ${f.note}` : ''}
        </li>
      ))}
    </ul>
  );
}
