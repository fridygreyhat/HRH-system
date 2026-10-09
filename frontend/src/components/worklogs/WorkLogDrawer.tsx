import { ApprovalStepper } from './ApprovalStepper';
import React, { useState } from 'react';
import { api, ApiError } from '../../api';
import {
  dateOnly,
  dateTime,
  datesBetween,
  DESTRUCTIVE_ACTIONS,
  hoursAge,
  humanize,
  LOCATION_LABELS,
  label,
  num,
  timeShort,
  WORKLOG_ACTION_LABELS,
  WORKLOG_REASON_REQUIRED,
} from '../../format';
import { useApi } from '../../hooks';
import { navigate } from '../../nav';
import { ReturnFlag, WorkLogDetail, WorkLogSnapshot } from '../../types';
import { Alert, AuditTimeline, DevCodeNotice, Drawer, Facts, Field, Modal, ReasonDialog, Section, StatusBadge } from '../ui';
import { EntriesView, FLAG_GENERAL_FIELDS, FlagsList, TotalsPanel } from './shared';

const ACTION_HELP: Record<string, string> = {
  verify: 'Confirms the work occurred. The current content is frozen as a new version and the provider receives an SMS code to confirm it.',
  endorse: 'Technical endorsement of the provider-confirmed version.',
  authorize: 'Final program and budget authorization. Approval is not payment.',
  return: 'Send back to the provider for correction. Resubmission restarts the whole review chain.',
  return_to_reviewer: 'Send back to the previous review stage.',
  reject: 'Final rejection of this work log.',
  hold: 'Place on budget hold until released.',
  release: 'Release the budget hold back to RPM authorization.',
  reopen: 'Reopen an approved log for correction (linked claims must be cancelled first).',
  facility_endorse: 'Record the Facility In-Charge endorsement required by this cadre form.',
};

function FlagEditor({ log, flags, onChange }: { log: WorkLogDetail; flags: ReturnFlag[]; onChange: (f: ReturnFlag[]) => void }) {
  const [date, setDate] = useState(log.entries[0]?.entry_date || log.period.start_date);
  const [field, setField] = useState('evidence');
  const [note, setNote] = useState('');
  const entryDates = new Set(log.entries.map((e) => e.entry_date));
  const add = () => {
    onChange([...flags, { entry_date: date, field, note: note.trim() }]);
    setNote('');
  };
  return (
    <fieldset className="stack">
      <legend>Flag specific dates and fields (optional)</legend>
      <div className="flag-row">
        <Field label="Date">
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {datesBetween(log.period.start_date, log.period.end_date).map((d) => (
              <option key={d} value={d}>
                {dateOnly(d)}
                {entryDates.has(d) ? '' : ' (no entry)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Field">
          <select value={field} onChange={(e) => setField(e.target.value)}>
            {FLAG_GENERAL_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.en}
              </option>
            ))}
            {log.cadre.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label_en}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note">
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-secondary" onClick={add}>
          Add flag
        </button>
      </div>
      {flags.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
          {flags.map((f, i) => (
            <li key={`${f.entry_date}-${f.field}-${i}`}>
              {dateOnly(f.entry_date)} · {FLAG_GENERAL_FIELDS.find((g) => g.key === f.field)?.en || log.cadre.fields.find((c) => c.key === f.field)?.label_en || f.field}
              {f.note ? `: ${f.note}` : ''}{' '}
              <button type="button" className="link small" onClick={() => onChange(flags.filter((_, j) => j !== i))}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function VersionModal({ log, version, onClose }: { log: WorkLogDetail; version: number; onClose: () => void }) {
  const { data, error, loading } = useApi<WorkLogSnapshot>(`/worklogs/${log.id}/versions/${version}`);
  const s = data?.snapshot;
  return (
    <Modal title={`Version ${version} (frozen at CTC verification)`} onClose={onClose}>
      <Alert>{error}</Alert>
      {loading && !data && <p className="muted">Loading…</p>}
      {s && (
        <div className="stack">
          <p className="muted small">
            Frozen {dateTime(data.created_at)} · {s.staff.name} · {s.cadre} · {s.period.label || `${s.period.start} – ${s.period.end}`}
            {s.occupation ? ` · ${s.occupation}${s.occupation_other ? ` (${s.occupation_other})` : ''}` : ''}
            {s.section ? ` · ${s.section}` : ''}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Hours</th>
                  {log.cadre.fields.map((f) => (
                    <th key={f.key} className="num">
                      {f.label_en}
                    </th>
                  ))}
                  <th>Evidence</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {s.entries.map((e) => (
                  <tr key={e.date}>
                    <td className="nowrap">
                      {dateOnly(e.date)}
                      {e.start_time ? <div className="muted small">{`${timeShort(e.start_time)}–${timeShort(e.end_time)}`}</div> : null}
                    </td>
                    <td className="num">{num(e.hours)}</td>
                    {log.cadre.fields.map((f) => (
                      <td key={f.key} className="num">
                        {e.measures[f.key] === undefined ? '—' : f.field_type === 'BOOLEAN' ? (Number(e.measures[f.key]) ? 'Yes' : 'No') : num(e.measures[f.key])}
                      </td>
                    ))}
                    <td>{e.evidence}</td>
                    <td className="small">{label(LOCATION_LABELS, e.location_status)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total ({num(s.totals.days)} days)</th>
                  <th className="num">{num(s.totals.hours)}</th>
                  {log.cadre.fields.map((f) => (
                    <th key={f.key} className="num">
                      {num(s.totals.measures[f.key] ?? 0)}
                    </th>
                  ))}
                  <th colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          {s.period_comment && <p className="small">Period comment: {s.period_comment}</p>}
        </div>
      )}
    </Modal>
  );
}

/** Reviewer detail drawer for one work log. Buttons come only from the server's `available_actions`. */
export function WorkLogDrawer({ logId, onClose, onChanged }: { logId: number; onClose: () => void; onChanged?: () => void }) {
  const { data: log, error, loading, setData, reload } = useApi<WorkLogDetail>(`/worklogs/${logId}`);
  const [action, setAction] = useState<string | null>(null);
  const [flags, setFlags] = useState<ReturnFlag[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [version, setVersion] = useState<number | null>(null);

  const perform = async (comment: string) => {
    if (!log || !action) return;
    try {
      const result = await api.post<WorkLogDetail>(`/worklogs/${log.id}/actions/${action}`, {
        comment: comment || null,
        expected_version: log.version,
        flags: action === 'return' ? flags : [],
      });
      setData(result);
      setNotice(`${WORKLOG_ACTION_LABELS[action] || humanize(action)}: done.`);
      setDevOtp(result.otp?.dev_otp || null);
      setAction(null);
      setFlags([]);
      onChanged?.();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && /changed since/i.test(e.message)) {
        setConflict(true);
        setAction(null);
        return;
      }
      throw e;
    }
  };

  const reloadAfterConflict = async () => {
    setConflict(false);
    await reload();
  };

  return (
    <Drawer title={log ? `${log.staff_name} · ${log.period_label}` : `Work log #${logId}`} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {!log && loading && <p className="muted">Loading…</p>}
      {log && (
        <div className="stack-lg">
          <div className="row-between">
            <div className="badges">
              <StatusBadge kind="log" status={log.status} />
              <span className="badge badge-neutral">Version {log.version}</span>
              <span className={`badge ${log.hours_in_status > 48 ? 'badge-danger' : 'badge-neutral'}`}>In status {hoursAge(log.hours_in_status)}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('print', log.id)}>
              Print view
            </button>
          </div>
          <ApprovalStepper status={log.status} audit={log.audit} hoursInStatus={log.hours_in_status} facilityEndorsed={log.endorsements.find((e) => e.version === log.version && e.kind === 'FACILITY_IN_CHARGE')?.actor_name} technicalReviewer={log.cadre?.technical_reviewer_title} />
          {conflict && (
            <div className="alert alert-warn" role="alert">
              This work log changed since you opened it, so your action was not applied. Reload and review it again.{' '}
              <button className="btn btn-secondary btn-sm" onClick={reloadAfterConflict}>
                Reload
              </button>
            </div>
          )}
          <Alert kind="success">{notice}</Alert>
          <DevCodeNotice code={devOtp} label="Development code sent to the provider (test mode only — real providers receive it by SMS)" />

          {log.available_actions.length > 0 && (
            <Section title="Your decision">
              <div className="row">
                {log.available_actions.map((a) => (
                  <button key={a} className={`btn ${DESTRUCTIVE_ACTIONS.has(a) ? 'btn-secondary' : 'btn-primary'}`} onClick={() => setAction(a)}>
                    {WORKLOG_ACTION_LABELS[a] || humanize(a)}
                  </button>
                ))}
              </div>
              <p className="muted small">Each work log is decided individually after reviewing its entries.</p>
            </Section>
          )}

          {log.location_exception_count > 0 && (
            <p className="notice">
              {log.location_exception_count} day(s) have a location exception for human review. Location exceptions are not rejections.
            </p>
          )}

          <Section title="Header">
            <Facts
              items={[
                ['Provider', log.staff.name],
                ['Cadre', `${log.cadre.name} (${log.cadre.code})`],
                ['Occupation', log.occupation ? `${log.occupation}${log.occupation_other ? ` – ${log.occupation_other}` : ''}` : null],
                ['Section', log.section],
                ['Salary scale', log.staff.salary_scale],
                ['Region', log.assignment?.region],
                ['District', log.assignment?.district],
                ['Ward', log.assignment?.ward],
                ['Facility', log.assignment?.facility],
                ['Community area', log.assignment?.community_area],
                ['Period', `${dateOnly(log.period.start_date)} – ${dateOnly(log.period.end_date)}`],
                ['Submitted', dateTime(log.submitted_at)],
                ['Attested', dateTime(log.attested_at)],
                ['Provider confirmed version', log.confirmed_version],
              ]}
            />
            {log.period_comment && <p className="small">Period comment: “{log.period_comment}”</p>}
          </Section>

          <Section title={`Daily entries (${log.entries.length})`}>
            <EntriesView log={log} lang="en" />
            {!log.gps_visible && <p className="muted small">GPS coordinates are not shown for your role; only the location status is.</p>}
          </Section>

          <TotalsPanel log={log} lang="en" title="Totals (server-calculated)" />

          {(log.cadre.requires_facility_endorsement || log.endorsements.length > 0) && (
            <Section title="Endorsements">
              {log.cadre.requires_facility_endorsement && <p className="muted small">This cadre form requires a Facility In-Charge endorsement before technical review.</p>}
              {log.endorsements.length ? (
                <ul className="small">
                  {log.endorsements.map((e) => (
                    <li key={e.id}>
                      {humanize(e.kind)} by {e.actor_name} (version {e.version}){e.created_at ? ` · ${dateTime(e.created_at)}` : ''}
                      {e.comment ? ` – “${e.comment}”` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">None recorded.</p>
              )}
            </Section>
          )}

          <Section title="Versions">
            {log.versions.length ? (
              <div className="row">
                {log.versions.map((v) => (
                  <button key={v.version} className="btn btn-secondary btn-sm" onClick={() => setVersion(v.version)}>
                    Version {v.version} · {dateTime(v.created_at)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No frozen versions yet (created at CTC verification).</p>
            )}
          </Section>

          {log.claims.length > 0 && (
            <Section title="Linked claims">
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {log.claims.map((c) => (
                  <li key={c.id} className="row">
                    Claim #{c.id} <StatusBadge kind="claim" status={c.status} /> <StatusBadge kind="payment" status={c.payment_status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Audit trail">
            <AuditTimeline
              rows={log.audit.map((a) => ({
                ...a,
                extra: a.details?.flags?.length ? <FlagsList flags={a.details.flags} cadre={log.cadre} lang="en" /> : null,
              }))}
              actionLabels={WORKLOG_ACTION_LABELS}
              statusKind="log"
            />
          </Section>
        </div>
      )}

      {log && action && (
        <ReasonDialog
          title={WORKLOG_ACTION_LABELS[action] || humanize(action)}
          description={ACTION_HELP[action]}
          required={WORKLOG_REASON_REQUIRED.has(action)}
          danger={DESTRUCTIVE_ACTIONS.has(action)}
          confirmLabel={WORKLOG_ACTION_LABELS[action] || humanize(action)}
          onConfirm={perform}
          onClose={() => {
            setAction(null);
            setFlags([]);
          }}
        >
          {action === 'return' && <FlagEditor log={log} flags={flags} onChange={setFlags} />}
        </ReasonDialog>
      )}
      {log && version !== null && <VersionModal log={log} version={version} onClose={() => setVersion(null)} />}
    </Drawer>
  );
}
