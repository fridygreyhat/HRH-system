import { ApprovalStepper } from './ApprovalStepper';
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
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
import { ChannelResponse, ClaimCategory, FinancePayorsResponse, ReturnFlag, WorkLogDetail, WorkLogSnapshot } from '../../types';
import { Alert, AuditTimeline, DevCodeNotice, Drawer, Facts, Field, Modal, ReasonDialog, Section, StatusBadge } from '../ui';
import { EntriesView, FLAG_GENERAL_FIELDS, FlagsList, TotalsPanel } from './shared';

const ACTION_HELP: Record<string, string> = {
  verify: 'Confirms the work occurred and freezes the current content as a new version.',
  endorse: 'Technical endorsement of the verified version.',
  authorize: 'Final program and budget authorization. Approval is not payment.',
  return: 'Send back to the provider for correction. Resubmission restarts the whole review chain.',
  return_to_reviewer: 'Send back to the previous review stage.',
  reject: 'Final rejection of this work log.',
  hold: 'Place on budget hold until released.',
  release: 'Release the budget hold back to RM authorization.',
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

function snapshotCategoryId(log: WorkLogDetail): string {
  const value = log.finance_snapshot?.category_id;
  return value === null || value === undefined ? '' : String(value);
}

/** Reviewer detail drawer for one work log. Buttons come only from the server's `available_actions`. */
export function WorkLogDrawer({ logId, onClose, onChanged }: { logId: number; onClose: () => void; onChanged?: () => void }) {
  const { hasRole } = useAuth();
  const isRpmWithoutFinanceRole = hasRole('RPM') && !hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE');
  const { data: log, error, loading, setData, reload } = useApi<WorkLogDetail>(`/worklogs/${logId}`);
  const [action, setAction] = useState<string | null>(null);
  const [flags, setFlags] = useState<ReturnFlag[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [reviewReached, setReviewReached] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [targetPayorId, setTargetPayorId] = useState('');
  const reviewMarker = useRef<HTMLDivElement | null>(null);
  const categories = useApi<ClaimCategory[]>(log?.workflow_version === 2 && (Boolean(log.finance_snapshot) || log.available_actions.includes('finance_review')) ? '/admin/claim-categories' : null);
  const routingActionAvailable = Boolean(log?.available_actions.some((item) => item === 'route_fhi360' || item === 'route_cso'));
  const payors = useApi<FinancePayorsResponse>(routingActionAvailable ? `/finance/payors?work_log_id=${logId}` : null);

  useEffect(() => {
    setReviewConfirmed(false);
    setReviewReached(false);
    setCategoryId(log ? snapshotCategoryId(log) : '');
    setTargetPayorId('');
  }, [log]);

  useEffect(() => {
    const marker = reviewMarker.current;
    if (!marker || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setReviewReached(true);
    }, { threshold: 0.1 });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [log?.id, log?.version, log?.status]);

  const perform = async (comment: string) => {
    if (!log || !action) return;
    try {
      if (action === 'route_fhi360' || action === 'route_cso') {
        if (!targetPayorId) throw new Error('Choose the destination payor before channeling this work log.');
        const pendingClaim = log.claims.find((claim) => claim.status === 'PENDING_ROUTING');
        const result = await api.post<ChannelResponse>('/finance/channel', {
          work_log_id: log.id,
          ...(pendingClaim ? { claim_id: pendingClaim.id } : {}),
          target_payor_id: Number(targetPayorId),
          review_confirmed: true,
          review_type: log.work_type,
          expected_version: log.version,
          comment: comment || null,
        });
        setNotice(`Channelled to ${result.payor_name} · ${result.currency} ${result.amount}.`);
        setAction(null);
        setTargetPayorId('');
        await reload();
        onChanged?.();
        return;
      }
      const result = await api.post<WorkLogDetail>(`/worklogs/${log.id}/actions/${action}`, {
        comment: comment || null,
        expected_version: log.version,
        flags: action === 'return' ? flags : [],
        ...(log.workflow_version === 2 ? {
          review_confirmed: true,
          review_type: log.work_type,
          ...(action === 'finance_review' ? { category_id: Number(categoryId) } : {}),
        } : {}),
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
          <ApprovalStepper status={log.status} audit={log.audit} hoursInStatus={log.hours_in_status} facilityEndorsed={log.endorsements.find((e) => e.version === log.version && e.kind === 'FACILITY_IN_CHARGE')?.actor_name} technicalReviewer={log.cadre?.technical_reviewer_title} workflowVersion={log.workflow_version} workType={log.work_type} />
          <Section title="Monthly provider summary">
            <div className="row">
              <span className="badge badge-neutral">Weekday daily limit: {log.review_summary?.limits.daily_hours} h</span>
              <span className="badge badge-neutral">Monday–Friday limit: {log.review_summary?.limits.weekly_hours} h</span>
              <span className="badge badge-neutral">Saturday clinics: {log.review_summary?.limits.saturday_min_hours}–{log.review_summary?.limits.saturday_max_hours} h, counted separately</span>
              <span className="badge badge-neutral">No Sunday work</span>
            </div>
            {(log.review_summary?.months || []).map((month) => (
              <div key={month.month} className="stack">
                <h4>{month.month} · {num(month.days)} days · {num(Number(month.hours))} hours</h4>
                <dl className="totals-list">
                  {log.cadre.fields.filter((field) => Number(month.metrics[field.key] ?? 0) > 0).map((field) => (
                    <div key={field.key}>
                      <dt>{field.label_en}</dt>
                      <dd>{num(Number(month.metrics[field.key]))}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <p className="muted small">Calendar-month totals include this provider's work logs visible within your permissions. The daily entries below belong to the selected log.</p>
            {log.review_summary?.anomalies?.length > 0 && (
              <div className="alert alert-warn" role="status">
                <strong>Review flags — check these before deciding.</strong>
                <ul>{log.review_summary.anomalies.map((anomaly, index) => (
                  <li key={`${anomaly.date || 'monthly'}-${anomaly.code}-${index}`}>{anomaly.date ? `${dateOnly(anomaly.date)} · ` : ''}{anomaly.message}</li>
                ))}</ul>
              </div>
            )}
            <p className="muted small">Hour limits are enforced when entries are saved. Measure flags highlight possible data issues and do not automatically reject a log.</p>
          </Section>
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
              {log.claims.some((claim) => claim.status === 'PENDING_FINANCE_REVIEW') && (
                <p className="notice notice-info">
                  RM authorization records a pending finance claim from the activity rate snapshots. This is an operational record for finance review—not routed, budget-committed or payable. Regional Finance reviews this same claim and selects its category.
                </p>
              )}
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {log.claims.map((c) => (
                  <li key={c.id} className="row">
                    <span>Claim #{c.id}{c.category_name ? ` · ${c.category_name}` : c.category_id == null ? ' · Category not selected' : ''}{c.amount != null ? ` · ${c.currency || 'TZS'} ${num(c.amount)}` : ''}</span>
                    <StatusBadge kind="claim" status={c.status} /> <StatusBadge kind="payment" status={c.payment_status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {log.workflow_version === 2 && log.financial_preview && (
            <Section title="Financial preview">
              <p className="muted small">Indicative only until finance review. Historical paid records retain their original snapshot.</p>
              {log.financial_preview.exceptions.length > 0 && (
                <div className="alert alert-warn"><strong>Exceptions</strong><ul>{log.financial_preview.exceptions.map((exception, i) => <li key={`${exception}-${i}`}>{exception}</li>)}</ul></div>
              )}
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Activity</th><th className="num">Units</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                  <tbody>{log.financial_preview.lines.map((line) => (
                    <tr key={line.entry_id}><td>{dateOnly(line.date)}</td><td>{line.activity}</td><td className="num">{line.units}</td><td className="num">{line.rate == null ? <span className="badge badge-warn">Rate missing</span> : `${line.rate}${line.currency ? ` ${line.currency}` : ''}`}</td><td className="num">{line.amount == null ? '—' : `${line.amount}${line.currency ? ` ${line.currency}` : ''}`}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <p><strong>Total: {log.financial_preview.total} {log.financial_preview.currency || ''}</strong></p>
            </Section>
          )}
          {log.workflow_version === 2 && log.finance_snapshot && (
            <Section title="Finance snapshot · immutable">
              <p className="muted small">This saved snapshot is retained with the work log. Later rate revisions do not rewrite it.</p>
              {(() => {
                const snapshot = log.finance_snapshot || {};
                const rawLines = Array.isArray(snapshot.lines) ? snapshot.lines : Array.isArray(snapshot.components) ? snapshot.components : [];
                const lines = rawLines.filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === 'object');
                const categoryLookup = categories.data?.find((item) => String(item.id) === String(snapshot.category_id));
                const category = typeof snapshot.category_name === 'string'
                  ? snapshot.category_name
                  : typeof snapshot.category === 'string'
                    ? snapshot.category
                    : snapshot.category && typeof snapshot.category === 'object' && 'name' in snapshot.category
                      ? String((snapshot.category as { name: unknown }).name)
                      : categoryLookup
                        ? categoryLookup.name
                        : snapshot.category_id !== undefined && snapshot.category_id !== null
                          ? `Category #${String(snapshot.category_id)}`
                          : 'Not selected yet';
                return <>
                  <p><strong>Finance category:</strong> {category}</p>
                  {lines.length > 0 && <div className="table-wrap"><table>
                    <thead><tr><th>Date</th><th>Activity / component</th><th className="num">Units</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                    <tbody>{lines.map((line, index) => <tr key={String(line.entry_id ?? line.id ?? index)}>
                      <td>{String(line.date ?? '—')}</td>
                      <td>{String(line.activity ?? line.component_name ?? line.component ?? '—')}</td>
                      <td className="num">{String(line.units ?? '—')}</td>
                      <td className="num">{line.rate == null ? <span className="badge badge-warn">Rate missing</span> : String(line.rate)}</td>
                      <td className="num">{line.amount == null ? '—' : `${String(line.amount)}${line.currency ? ` ${String(line.currency)}` : ''}`}</td>
                    </tr>)}</tbody>
                  </table></div>}
                  {snapshot.total !== undefined && <p><strong>Saved total:</strong> {String(snapshot.total)} {String(snapshot.currency || '')}</p>}
                </>;
              })()}
              <details><summary className="small">View full saved snapshot</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{JSON.stringify(log.finance_snapshot, null, 2)}</pre></details>
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

          <div ref={reviewMarker} aria-hidden="true" style={{ height: 1 }} />
          {log.available_actions.length > 0 && (
            <Section title="Review and decide">
              <p className="muted small">
                Review the monthly summary, flags, and all daily entries above before recording your decision.
              </p>
              {!reviewReached && <p className="notice notice-info">Scroll through the full work-log detail before confirming your review.</p>}
              {log.workflow_version === 2 && log.available_actions.includes('finance_review') && (
                <Field label="Claim category">
                  <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Choose category…</option>
                    {(categories.data || []).filter((category) => category.is_active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </Field>
              )}
              <label className="row">
                <input type="checkbox" checked={reviewConfirmed} disabled={!reviewReached} onChange={(e) => setReviewConfirmed(e.target.checked)} />
                <span>I have cross-checked all entries and the monthly summary.</span>
              </label>
              <div className="row">
                {log.available_actions.filter((a) => !isRpmWithoutFinanceRole || !['route_fhi360', 'route_cso', 'paid'].includes(a)).map((a) => (
                  <button key={a} className={`btn ${DESTRUCTIVE_ACTIONS.has(a) ? 'btn-secondary' : 'btn-primary'}`} disabled={!reviewReached || !reviewConfirmed || (a === 'finance_review' && !categoryId)} onClick={() => setAction(a)}>
                    {WORKLOG_ACTION_LABELS[a] || humanize(a)}
                  </button>
                ))}
              </div>
            </Section>
          )}
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
          {(action === 'route_fhi360' || action === 'route_cso') && (
            <div className="stack">
              <Alert>{payors.error}</Alert>
              {payors.error && <button type="button" className="btn btn-secondary btn-sm" onClick={payors.reload}>Retry eligible payors</button>}
              {payors.loading && <p className="muted small" role="status">Loading eligible payors…</p>}
              {payors.data?.routing_exception && <div className="alert alert-warn" role="alert">{payors.data.routing_exception}</div>}
              <Field label="Destination payor" hint="Choose explicitly. The correct organization is based on the provider’s verified assignment.">
                <select required value={targetPayorId} onChange={(event) => setTargetPayorId(event.target.value)} disabled={payors.loading || Boolean(payors.error)}>
                  <option value="">Choose destination payor…</option>
                  {(payors.data?.eligible_payors || []).map((payor) => <option key={payor.id} value={payor.id}>{payor.name} · {payor.type}</option>)}
                </select>
              </Field>
              {!payors.loading && !payors.error && payors.data?.eligible_payors.length === 0 && <p className="muted small">No eligible destination is available. Resolve the routing exception before channeling.</p>}
            </div>
          )}
        </ReasonDialog>
      )}
      {log && version !== null && <VersionModal log={log} version={version} onClose={() => setVersion(null)} />}
    </Drawer>
  );
}
