import React, { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, weekday } from '../../format';
import { useAction } from '../../hooks';
import { ReturnFlag, WorkLogDetail, WorkLogEntry } from '../../types';
import { Alert, Field } from '../ui';
import { FieldLabel, flagFieldLabel } from './shared';
import { GroupedIndicators } from './GroupedIndicators';

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
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const valid = [latitude, longitude, accuracy].every(Number.isFinite) &&
          latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 && accuracy >= 0;
        resolve(valid ? { gps_lat: latitude, gps_lon: longitude, gps_accuracy_m: Math.round(accuracy) } : null);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
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
  const requiresGps = ['CHW', 'HCP', 'DATA_CLERK'].includes(log.cadre.code);
  const captureGps = requiresGps || captureOnEntry;
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const isSaturday = dayOfWeek === 6;
  const isSunday = dayOfWeek === 0;
  const limits = log.review_summary.limits;
  const minimumHours = isSaturday ? Number(limits.saturday_min_hours) : 0.25;
  const maximumHours = Number(isSaturday ? limits.saturday_max_hours : limits.daily_hours);
  const backdateAccess = log.backdate_access;
  const dateGrant = backdateAccess?.grants.find((grant) => grant.entry_date === date);
  const cadreActivities = log.cadre.activities || [];
  const allActivities = log.cadre.code === 'CHW' && (log.work_type === 'SERVICES' || log.work_type === 'PAYROLL')
    ? cadreActivities.filter((activity) => !activity.item_type || activity.item_type === log.work_type)
    : cadreActivities;
  const applicableActivities = allActivities.filter((activity) =>
    (!activity.effective_start_date || activity.effective_start_date <= date) &&
    (!activity.effective_end_date || date < activity.effective_end_date),
  );
  const activities = entry?.activity_key && !applicableActivities.some((activity) => activity.key === entry.activity_key)
    ? [...applicableActivities, ...allActivities.filter((activity) => activity.key === entry.activity_key)]
    : applicableActivities;
  const isHcp = log.cadre.code === 'HCP';
  const isChw = log.cadre.code === 'CHW';
  const isDataClerk = log.cadre.code === 'DATA_CLERK';
  const hidesEvidence = isHcp || isChw || isDataClerk;
  const defaultChwActivity = applicableActivities.find((activity) => activity.key === 'chw_daily_timesheet');
  const defaultClerkActivity = applicableActivities.find((activity) => activity.key === 'data_clerk_daily_timesheet');
  const [activityKey, setActivityKey] = useState(entry?.activity_key || (isHcp ? '' : (isChw ? defaultChwActivity : isDataClerk ? defaultClerkActivity : undefined)?.key || applicableActivities[0]?.key || allActivities[0]?.key || ''));
  const selectedActivity = activities.find((activity) => activity.key === activityKey);
  const activityType = selectedActivity?.item_type || log.work_type;
  const [indicatorGroupKey, setIndicatorGroupKey] = useState('');
  const isGroupedIndicators = Boolean(selectedActivity?.groups?.length) && ((isChw && activityType === 'PAYROLL') || isDataClerk);
  const selectedIndicatorGroup = selectedActivity?.groups?.find((group) => group.key === indicatorGroupKey)
    || selectedActivity?.groups?.[0];
  const requiresLocation = Boolean(selectedActivity?.requires_location || activityKey === 'secondary_facility');
  const direct = log.cadre.hours_mode === 'DIRECT' || Boolean(selectedActivity?.hours_input);
  const visibleFields = !isHcp && !isChw && !isDataClerk && (selectedActivity?.item_type === 'PAYROLL' || log.work_type === 'PAYROLL')
    ? []
    : selectedActivity
      ? selectedActivity.fields.flatMap((key) => log.cadre.fields.filter((field) => field.key === key))
      : isHcp ? [] : log.cadre.fields;
  const [hours, setHours] = useState(entry ? String(Number(entry.hours_worked)) : '');
  const [activityLocation, setActivityLocation] = useState(entry?.activity_location || '');
  const [start, setStart] = useState(entry?.start_time?.slice(0, 5) || '');
  const [end, setEnd] = useState(entry?.end_time?.slice(0, 5) || '');
  const [measures, setMeasures] = useState<MeasureInput>(() => initialMeasures(log, entry));
  const [evidence, setEvidence] = useState(entry?.evidence_text || '');
  const [comment, setComment] = useState(entry?.comment || '');
  const [gps, setGps] = useState<GpsFix | null>(null);
  const [gpsState, setGpsState] = useState<'idle' | 'busy' | 'ok' | 'failed'>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useAction();
  const remove = useAction();

  const flaggedFields = new Set(flags.filter((f) => f.entry_date === date).map((f) => f.field));
  const dayFlags = flags.filter((f) => f.entry_date === date);
  const idWarning = !hidesEvidence && (ID_LIKE.test(evidence) || ID_LIKE.test(comment));

  const getLocation = async () => {
    setGpsState('busy');
    const fix = await captureLocation();
    setGps(fix);
    setGpsState(fix ? 'ok' : 'failed');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requiresGps && (!gps || gpsState !== 'ok')) {
      setValidationError(lang === 'sw' ? 'Nasa mahali ulipo kabla ya kuhifadhi siku hii.' : 'Capture your current location before saving this day.');
      return;
    }
    const missing = (selectedActivity?.required_fields || []).filter((key) => measures[key] === undefined || measures[key] === '');
    if (missing.length) {
      if (isGroupedIndicators) {
        const firstIncompleteGroup = selectedActivity?.groups?.find((group) => group.fields.some((key) => missing.includes(key)));
        if (firstIncompleteGroup) setIndicatorGroupKey(firstIncompleteGroup.key);
        const groupName = firstIncompleteGroup ? (lang === 'sw' ? firstIncompleteGroup.label_sw : firstIncompleteGroup.label_en) : '';
        setValidationError(lang === 'sw'
          ? `Jaza viashiria vyote vinavyohitajika katika kundi la ${groupName}. Weka sifuri au chagua Ndiyo/Hapana.`
          : `Complete all required indicators in ${groupName}. Enter zero for none and choose Yes or No for each checklist item.`);
      } else {
        setValidationError(lang === 'sw' ? 'Jaza viashiria vyote vinavyohitajika. Weka sifuri au chagua Ndiyo/Hapana.' : 'Complete all required activity indicators. Enter zero for none and choose Yes or No for each checklist item.');
      }
      return;
    }
    setValidationError(null);
    const payload: Record<string, unknown> = {
      activity_key: activityKey,
      ...(requiresLocation ? { activity_location: activityLocation.trim() } : {}),
      ...(!hidesEvidence ? { evidence_text: evidence.trim(), comment: comment.trim() || null } : {}),
      measures: Object.fromEntries(
        visibleFields
          .filter((f) => measures[f.key] !== undefined && measures[f.key] !== '')
          .map((f) => [f.key, f.field_type === 'BOOLEAN' ? measures[f.key] === true : Number(measures[f.key])]),
      ),
    };
    if (direct) payload.hours_worked = Number(hours);
    else {
      payload.start_time = start;
      payload.end_time = end;
    }
    if (captureGps && gps) Object.assign(payload, gps);
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

      <p className={isSunday ? 'alert alert-warn' : 'muted small'}>
        {lang === 'sw'
          ? `Jumatatu–Ijumaa: hadi saa ${limits.daily_hours} kwa siku na ${limits.weekly_hours} kwa wiki. Kliniki za Jumamosi: saa ${limits.saturday_min_hours}–${limits.saturday_max_hours}, hazihesabiwi kwenye kikomo cha siku za kazi. Kazi ya Jumapili hairuhusiwi.`
          : `Monday–Friday: up to ${limits.daily_hours} hours per day and ${limits.weekly_hours} total. Saturday weekend clinics: ${limits.saturday_min_hours}–${limits.saturday_max_hours} hours, separate from the weekday limit. Sunday work is not allowed.`}
      </p>
      {backdateAccess && (
        <p className="notice notice-info" role="note">
          {dateGrant
            ? <>This date has approved backdated access until <strong>{new Date(dateGrant.expires_at).toLocaleString()}</strong>.</>
            : <>New entries can normally be made up to {backdateAccess.grace_hours} hours after work completion. A Technical Officer can grant temporary access for a missed older date.</>}
        </p>
      )}

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

      {activities.length > 0 && (
        <Field
          label={isHcp
            ? activityType === 'PAYROLL' ? (lang === 'sw' ? 'Kituo cha kila siku' : 'Daily facility cascade')
              : activityType === 'SERVICES' ? (lang === 'sw' ? 'Huduma' : 'Service')
                : (lang === 'sw' ? 'Aina ya shughuli ya HCP' : 'HCP activity type')
            : isDataClerk
              ? (lang === 'sw' ? 'Shughuli ya siku' : 'Daily, secondary facility, or clinic activity')
            : lang === 'sw' ? 'Aina ya shughuli' : 'Activity'}
          hint={isHcp
            ? (lang === 'sw'
              ? 'Malipo (PAYROLL) ni daftari la kila siku la kituo; Huduma (SERVICES) hurekodi huduma kando.'
              : 'PAYROLL is the daily facility timesheet; SERVICES records services separately.')
            : lang === 'sw' ? 'Chagua shughuli ili kuonyesha viashiria vyake.' : 'Select an activity to show its specific indicators.'}
        >
          <select required value={activityKey} onChange={(e) => setActivityKey(e.target.value)}>
            {isHcp && <option value="">— {lang === 'sw' ? 'Chagua shughuli' : 'Select an activity'} —</option>}
            {activities.map((activity) => (
              <option key={activity.key} value={activity.key}>
                {isDataClerk
                  ? activity.key === 'data_clerk_daily_timesheet'
                    ? (lang === 'sw' ? 'Daftari la kila siku' : 'Daily timesheet')
                    : activity.key === 'data_clerk_secondary_facility'
                      ? (lang === 'sw' ? 'Kituo kingine' : 'Secondary facility')
                      : activity.key === 'data_clerk_weekend_clinic'
                        ? (lang === 'sw' ? 'Kliniki ya wikendi' : 'Weekend clinic')
                        : (lang === 'sw' ? activity.label_sw : activity.label_en)
                  : (lang === 'sw' ? activity.label_sw : activity.label_en)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {requiresLocation && (
        <Field label={lang === 'sw' ? 'Jina la kituo kingine' : 'Secondary facility name'}>
          <input required maxLength={255} value={activityLocation} onChange={(e) => setActivityLocation(e.target.value)} />
        </Field>
      )}

      {direct ? (
        <Field label={<FieldLabel field={{ label_en: 'Hours worked', label_sw: 'Masaa uliyofanya kazi' }} lang={lang} />} className={flaggedFields.has('hours') ? 'flagged-field' : undefined}>
          <input type="number" inputMode="decimal" min={minimumHours} max={maximumHours} step="0.25" required value={hours} onChange={(e) => setHours(e.target.value)} />
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

      {visibleFields.length > 0 && (
        <GroupedIndicators
          fields={visibleFields}
          groups={selectedActivity?.groups}
          requiredFields={selectedActivity?.required_fields || []}
          flaggedFields={flaggedFields}
          measures={measures}
          lang={lang}
          yesLabel={t('yes')}
          noLabel={t('no')}
          onChange={(key, value) => setMeasures({ ...measures, [key]: value })}
          selectedGroupKey={isGroupedIndicators ? selectedIndicatorGroup?.key : undefined}
          onGroupChange={isGroupedIndicators ? setIndicatorGroupKey : undefined}
          nativeRequired={!isGroupedIndicators}
          groupSelectorLabel={isDataClerk ? (lang === 'sw' ? 'Kundi la viashiria' : 'Indicator group') : undefined}
        />
      )}

      {!hidesEvidence && (
        <>
          <p className="notice" role="note">{t('evidenceWarning')}</p>
          <Field label={t('evidence')} className={flaggedFields.has('evidence') ? 'flagged-field' : undefined}>
            <textarea rows={3} required minLength={3} maxLength={2000} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          <Field label={t('comment')} className={flaggedFields.has('comment') ? 'flagged-field' : undefined}>
            <textarea rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          {idWarning && <Alert kind="warn">{t('evidenceWarning')}</Alert>}
        </>
      )}

      {captureGps && (
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
          <span className="field-hint">
            {requiresGps
              ? (lang === 'sw'
                ? 'Lazima unase mahali ulipo kabla ya kuhifadhi au kusahihisha siku hii. Ruhusu kivinjari kufikia mahali ulipo. Hii ni eneo la wakati wa kuingiza taarifa, si uthibitisho wa eneo la kazi ya siku iliyopita.'
                : 'Capture location before saving or updating this day. Allow location access in your browser. This records your location at entry time, not proof of where past work took place.')
              : t('gpsHint')}
          </span>
        </div>
      )}

      <Alert>{validationError || save.error || remove.error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || isSunday || (requiresGps && (!gps || gpsState !== 'ok')) || (!hidesEvidence && evidence.trim().length < 3)}>
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
