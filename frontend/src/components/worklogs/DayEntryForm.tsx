import React, { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, weekday } from '../../format';
import { useAction } from '../../hooks';
import { ReturnFlag, WorkLogDetail, WorkLogEntry } from '../../types';
import { Alert, Field } from '../ui';
import { FieldLabel, flagFieldLabel } from './shared';

export interface GpsFix {
  gps_lat: number;
  gps_lon: number;
  gps_accuracy_m: number;
}

/** Ask the browser for one location sample. Resolves null when unavailable or refused. */
export function captureLocation(): Promise<GpsFix | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ gps_lat: pos.coords.latitude, gps_lon: pos.coords.longitude, gps_accuracy_m: Math.round(pos.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

const ID_LIKE = /\d{8,}/;

type MeasureInput = Record<string, string | boolean | undefined>;

function initialMeasures(log: WorkLogDetail, entry?: WorkLogEntry): MeasureInput {
  const out: MeasureInput = {};
  log.cadre.fields.forEach((f) => {
    const v = entry?.measures[f.key];
    if (v === undefined || v === null) out[f.key] = f.field_type === 'BOOLEAN' ? undefined : '';
    else out[f.key] = f.field_type === 'BOOLEAN' ? Number(v) === 1 : String(Number(v));
  });
  return out;
}

interface Props {
  log: WorkLogDetail;
  date: string;
  entry?: WorkLogEntry;
  flags: ReturnFlag[];
  captureOnEntry: boolean;
  onSaved: (log: WorkLogDetail) => void;
  onClose: () => void;
}

/** One day's entry: hours (or start/end), one input per cadre field, evidence and optional GPS. */
export function DayEntryForm({ log, date, entry, flags, captureOnEntry, onSaved, onClose }: Props) {
  const { t, lang } = useAuth();
  const direct = log.cadre.hours_mode === 'DIRECT';
  const [hours, setHours] = useState(entry ? String(Number(entry.hours_worked)) : '');
  const [start, setStart] = useState(entry?.start_time?.slice(0, 5) || '');
  const [end, setEnd] = useState(entry?.end_time?.slice(0, 5) || '');
  const [measures, setMeasures] = useState<MeasureInput>(() => initialMeasures(log, entry));
  const [evidence, setEvidence] = useState(entry?.evidence_text || '');
  const [comment, setComment] = useState(entry?.comment || '');
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'busy' | 'ok' | 'failed'>('idle');
  const save = useAction();
  const remove = useAction();

  const flaggedFields = new Set(flags.filter((f) => f.entry_date === date).map((f) => f.field));
  const dayFlags = flags.filter((f) => f.entry_date === date);
  const idWarning = ID_LIKE.test(evidence) || ID_LIKE.test(comment);

  const getLocation = async () => {
    setGpsState('busy');
    const fix = await captureLocation();
    setGps(fix);
    setGpsState(fix ? 'ok' : 'failed');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      evidence_text: evidence.trim(),
      comment: comment.trim() || null,
      measures: Object.fromEntries(
        log.cadre.fields
          .filter((f) => measures[f.key] !== undefined && measures[f.key] !== '')
          .map((f) => [f.key, f.field_type === 'BOOLEAN' ? measures[f.key] === true : Number(measures[f.key])]),
      ),
    };
    if (direct) payload.hours_worked = Number(hours);
    else {
      payload.start_time = start;
      payload.end_time = end;
    }
    if (captureOnEntry && gps) Object.assign(payload, gps);
    const result = await save.run(() => api.put<WorkLogDetail>(`/worklogs/${log.id}/entries/${date}`, payload));
    if (result) onSaved(result);
  };

  const del = async () => {
    if (!window.confirm(t('confirmDelete'))) return;
    const result = await remove.run(() => api.del<WorkLogDetail>(`/worklogs/${log.id}/entries/${date}`));
    if (result) onSaved(result);
  };

  const busy = save.busy || remove.busy;

  return (
    <form className="card stack" onSubmit={submit} aria-label={`${t('editingDay')} ${dateOnly(date)}`} id="day-form">
      <div className="row-between">
        <h3>
          {t('editingDay')} {weekday(date, lang)} {dateOnly(date)}
        </h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          {t('close')}
        </button>
      </div>

      {dayFlags.length > 0 && (
        <div className="alert alert-warn">
          <strong>{t('flagged')}:</strong>
          <ul>
            {dayFlags.map((f, i) => (
              <li key={`${f.field}-${i}`}>
                {flagFieldLabel(log.cadre, f.field, lang)}
                {f.note ? `: ${f.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {direct ? (
        <Field label={<FieldLabel field={{ label_en: 'Hours worked', label_sw: 'Masaa uliyofanya kazi' }} lang={lang} />} className={flaggedFields.has('hours') ? 'flagged-field' : undefined}>
          <input type="number" inputMode="decimal" min="0.25" max="24" step="0.25" required value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
      ) : (
        <div className={`grid-2${flaggedFields.has('hours') ? ' flagged-field' : ''}`}>
          <Field label={<FieldLabel field={{ label_en: 'Start time', label_sw: 'Muda wa kuanza' }} lang={lang} />}>
            <input type="time" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={<FieldLabel field={{ label_en: 'End time', label_sw: 'Muda wa kumaliza' }} lang={lang} />} hint={t('hoursComputed')}>
            <input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="measure-grid">
        {log.cadre.fields.map((f) =>
          f.field_type === 'BOOLEAN' ? (
            <div key={f.key} className={`field${flaggedFields.has(f.key) ? ' flagged-field' : ''}`} role="group" aria-label={f.label_en}>
              <span className="field-label">
                <FieldLabel field={f} lang={lang} />
              </span>
              <div className="yesno">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    aria-pressed={measures[f.key] === v}
                    onClick={() => setMeasures({ ...measures, [f.key]: measures[f.key] === v ? undefined : v })}
                  >
                    {v ? t('yes') : t('no')}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Field key={f.key} label={<FieldLabel field={f} lang={lang} />} className={flaggedFields.has(f.key) ? 'flagged-field' : undefined}>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="10000"
                step="1"
                value={String(measures[f.key] ?? '')}
                onChange={(e) => setMeasures({ ...measures, [f.key]: e.target.value })}
              />
            </Field>
          ),
        )}
      </div>

      <p className="notice" role="note">
        ⚠ {t('evidenceWarning')}
      </p>
      <Field label={t('evidence')} className={flaggedFields.has('evidence') ? 'flagged-field' : undefined}>
        <textarea rows={3} required minLength={3} maxLength={2000} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
      </Field>
      <Field label={t('comment')} className={flaggedFields.has('comment') ? 'flagged-field' : undefined}>
        <textarea rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {idWarning && <Alert kind="warn">{t('evidenceWarning')}</Alert>}

      {captureOnEntry && (
        <div className={`stack${flaggedFields.has('location') ? ' flagged-field' : ''}`}>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={getLocation} disabled={gpsState === 'busy'}>
              {gpsState === 'busy' ? t('loading') : t('captureGps')}
            </button>
            {gpsState === 'ok' && gps && (
              <span className="badge badge-success">
                {t('gpsCaptured')} (±{gps.gps_accuracy_m} m)
              </span>
            )}
          </div>
          {gpsState === 'failed' && <Alert kind="warn">{t('gpsFailed')}</Alert>}
          <span className="field-hint">{t('gpsHint')}</span>
        </div>
      )}

      <Alert>{save.error || remove.error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || evidence.trim().length < 3}>
          {save.busy ? t('saving') : t('saveDay')}
        </button>
        {entry && (
          <button type="button" className="btn btn-secondary" onClick={del} disabled={busy}>
            {t('deleteDay')}
          </button>
        )}
      </div>
    </form>
  );
}
