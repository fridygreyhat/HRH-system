import { ApprovalStepper } from './ApprovalStepper';
import { PrintWorkLog } from '../../pages/PrintWorkLog';
import { ServiceTargets } from './ServiceTargets';
import { PaymentSetupNotice } from './PaymentSetupNotice';
import { AdminAudit } from '../AdminAudit';
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
  workHours,
} from '../../format';
import { useApi } from '../../hooks';
import { navigate } from '../../nav';
import { ChannelResponse, FinancePayorsResponse, ReturnFlag, WorkLogDetail, WorkLogSnapshot } from '../../types';
import { Alert, AuditTimeline, DevCodeNotice, Drawer, Facts, Field, Modal, ReasonDialog, Section, StatusBadge } from '../ui';
import { EntriesView, FLAG_GENERAL_FIELDS, FlagsList, TotalsPanel } from './shared';
import { buildServiceFinanceReviewPayload, canRouteReviewedFinanceContext, canSubmitServiceFinanceReview, FIXED_DAILY_NO_BUDGET, reviewedFinanceContextChanged, supportedServiceFundingSources } from './FundingReview';

const ACTION_HELP: Record<string, string> = {
  verify: 'Confirms the work occurred and freezes the current content as a new version.',
  endorse: 'Technical endorsement of the verified version.',
  authorize: 'Final authorization of the recorded work. Approval is not payment.',
  return: 'Send back to the provider for correction. Resubmission restarts the whole review chain.',
  return_to_reviewer: 'Send back to the previous review stage.',
  reject: 'Final rejection of this work log.',
  hold: 'Place this historical claim on hold.',
  release: 'Release this historical hold back to RM authorization.',
  reopen: 'Reopen an approved log for correction (linked claims must be cancelled first).',
  finance_timesheet_approve: 'Records your approval of the timesheet. The Services payment is reviewed separately next. Approval is not payment.',
  finance_review: 'Confirm the funding source and fixed daily amount before routing.',
};

function actionDisplayLabel(action: string, hasFinanceSnapshot: boolean): string {
  if (action === 'finance_review') return hasFinanceSnapshot ? 'Re-review Services payment' : 'Approve Services payment';
  if (action === 'release') return 'Release historical hold';
  if (action === 'hold') return 'Place historical claim on hold';
  return WORKLOG_ACTION_LABELS[action] || humanize(action);
}

/** Closed by default: reference details the reviewer opens only when needed. */
function Folded({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return <details className="card folded"><summary>{title}</summary><div className="stack">{children}</div></details>;
}

/** The reviewer's task and key numbers, shown before the timesheet. */
function ReviewSummary({ log, task, amount }: { log: WorkLogDetail; task: string; amount: string | null }) {
  const items: [string, string][] = [
    ['Days', num(log.totals.days)],
    ['Hours', workHours(log.totals.hours)],
    ['Flags', num(log.review_summary?.anomalies?.length || 0)],
    ...(amount ? [['Amount', amount] as [string, string]] : []),
  ];
  return (
    <section className="card review-summary" aria-label="Review summary">
      <p className="review-task">{task}</p>
      <dl>{items.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    </section>
  );
}

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
                    <td className="num">{workHours(e.hours)}</td>
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
                  <th className="num">{workHours(s.totals.hours)}</th>
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

type FundingSource = { id: number; code: string; name: string };

function snapshotFundingSourceId(log: WorkLogDetail): string {
  const value = log.finance_snapshot?.funding_source_id;
  return value === null || value === undefined ? '' : String(value);
}

/** Reviewer detail drawer for one work log. Buttons come only from the server's `available_actions`. */
export function WorkLogDrawer({ logId, onClose, onChanged }: { logId: number; onClose: () => void; onChanged?: () => void }) {
  const { hasRole } = useAuth();
  const isRpmWithoutFinanceRole = hasRole('RPM') && !hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE');
  const financeSummaryOnly = hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE')
    && !hasRole('SUPER_ADMIN', 'SYSTEM_ADMIN', 'CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'SUPERVISOR', 'TECHNICAL_OFFICER', 'RPM');
  const showTimesheet = hasRole('SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE');
  const { data: log, error, loading, setData, reload } = useApi<WorkLogDetail>(`/worklogs/${logId}`);
  const [action, setAction] = useState<string | null>(null);
  const [flags, setFlags] = useState<ReturnFlag[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [reviewReached, setReviewReached] = useState(false);
  const [fundingSourceId, setFundingSourceId] = useState('');
  const [targetPayorId, setTargetPayorId] = useState('');
  const [centralReviewerId, setCentralReviewerId] = useState('');
  const reviewMarker = useRef<HTMLDivElement | null>(null);
  const fundingSources = useApi<FundingSource[]>(log?.workflow_version === 2 && log.work_type === 'SERVICES' && (Boolean(log.finance_snapshot) || log.available_actions.includes('finance_review')) ? '/admin/funding-sources' : null);
  const routingActionAvailable = Boolean(log?.available_actions.some((item) => item === 'route_fhi360' || item === 'route_cso'));
  const regionalDecision = !!log && ['PENDING_FINANCE_REVIEW', 'FINANCE_REVIEWED'].includes(log.status);
  const timesheetStep = Boolean(log?.available_actions.includes('finance_timesheet_approve'));
  const paymentStep = log?.status === 'PENDING_FINANCE_REVIEW' && log.available_actions.includes('finance_review');
  const timesheetApprovedAt = log?.finance_timesheet_approved_at;
  const timesheetFolded = Boolean(timesheetApprovedAt && log?.available_actions.includes('finance_review'));
  const decisionTitle = timesheetStep ? 'Review 1 of 2 · Timesheet'
    : paymentStep ? 'Review 2 of 2 · Services payment'
      : routingActionAvailable ? 'Send to Central Finance' : 'Review and decide';
  const decisionLabel = (value: string) => value === 'verify' && log?.assignment && !log.assignment.facility ? 'Verify and approve (CSO Technical)'
    : regionalDecision && value === 'return' ? 'Return to cadre Technical'
    : regionalDecision && value === 'reject' ? 'Reject to provider' : actionDisplayLabel(value, Boolean(log?.finance_snapshot));
  const payors = useApi<FinancePayorsResponse>(routingActionAvailable ? `/finance/payors?work_log_id=${logId}` : null);
  const centralReviewers = useApi<{ id: number; name: string; username: string }[]>(routingActionAvailable ? `/finance/central-reviewers?work_log_id=${logId}` : null);

  useEffect(() => {
    setReviewConfirmed(false);
    setReviewReached(false);
    setFundingSourceId(log ? snapshotFundingSourceId(log) : '');
    setTargetPayorId('');
    setCentralReviewerId('');
  }, [log]);

  useEffect(() => {
    const marker = reviewMarker.current;
    if (!marker || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setReviewReached(true);
    }, { threshold: 0.1 });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [log?.id, log?.version, log?.status, timesheetApprovedAt]);

  const perform = async (comment: string) => {
    if (!log || !action) return;
    try {
      if (action === 'route_fhi360' || action === 'route_cso') {
        if (!targetPayorId) throw new Error('Choose the destination payor before channeling this work log.');
        if (!centralReviewerId) throw new Error('Choose a named Central Finance reviewer before routing these Services.');
        const pendingClaim = log.claims.find((claim) => claim.status === 'PENDING_ROUTING');
        const result = await api.post<ChannelResponse>('/finance/channel', {
          work_log_id: log.id,
          ...(pendingClaim ? { claim_id: pendingClaim.id } : {}),
          target_payor_id: Number(targetPayorId),
          central_reviewer_id: Number(centralReviewerId),
          review_confirmed: true,
          review_type: log.work_type,
          expected_version: log.version,
          expected_review_token: log.finance_snapshot?.review_token,
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
        ...(action === 'release' ? { expected_review_token: log.finance_snapshot?.review_token } : {}),
        flags: action === 'return' ? flags : [],
        ...(log.workflow_version === 2 ? {
          review_confirmed: true,
          review_type: log.work_type,
          ...(action === 'finance_review' && log.work_type === 'SERVICES'
            ? buildServiceFinanceReviewPayload({
              review_confirmed: true,
              review_type: log.work_type,
              expected_version: log.version,
              expected_review_token: log.finance_snapshot?.review_token,
              comment: comment || null,
            }, fundingSourceId)
            : {}),
        } : {}),
      });
      setData(result);
      setNotice(action === 'finance_timesheet_approve' ? 'Timesheet approved. Now review the Services payment.' : `${decisionLabel(action)}: done.`);
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

  const savedSourceId = log ? snapshotFundingSourceId(log) : '';
  const hasLegacySnapshot = Boolean(log?.finance_snapshot && log.work_type === 'SERVICES');
  const reviewedContextDirty = hasLegacySnapshot
    && reviewedFinanceContextChanged(fundingSourceId, savedSourceId);
  const availableFundingSources = supportedServiceFundingSources(fundingSources.data || []);
  const fixedDailyNoBudget = [FIXED_DAILY_NO_BUDGET, 'FIXED_DAILY_MONTHLY_REGIONAL_BUDGET'].includes(String(log?.finance_snapshot?.payment_policy || ''));

  const activeClaim = log?.claims.find((claim) => claim.status !== 'CANCELLED');
  const amountValue = activeClaim?.amount ?? log?.finance_snapshot?.total ?? log?.financial_preview?.total;
  const amountCurrency = activeClaim?.currency ?? log?.finance_snapshot?.currency ?? log?.financial_preview?.currency ?? 'TZS';
  const summaryAmount = log?.work_type === 'SERVICES' && !timesheetStep && amountValue != null ? `${amountCurrency} ${num(Number(amountValue))}` : null;
  const reviewTask = timesheetStep ? 'Your turn: approve the timesheet (review 1 of 2)'
    : paymentStep ? 'Your turn: approve the Services payment (review 2 of 2)'
      : routingActionAvailable ? 'Your turn: send to Central Finance'
        : log?.available_actions.length ? 'Your turn: review and decide' : 'No action needed from you';
  const decisionHelp = timesheetStep ? 'Check the timesheet, monthly totals and flags above. The Services payment is reviewed separately after this.'
    : paymentStep ? 'The timesheet is approved. Check the funding source and fixed daily amount, then approve the Services payment.'
      : financeSummaryOnly ? 'Review the timesheet, monthly totals and payment setup above before recording your Services decision.'
        : `Review the ${showTimesheet ? 'timesheet, ' : ''}monthly summary, flags, and all daily entries above before recording your decision.`;
  const confirmText = timesheetStep ? 'I have checked the timesheet, monthly totals and flags.'
    : paymentStep ? 'I have checked the funding source and Services payment amount.'
      : financeSummaryOnly ? 'I have cross-checked the timesheet, monthly summary and Services payment setup.' : 'I have cross-checked all entries and the monthly summary.';
  const flagsAlert = log && log.review_summary?.anomalies?.length > 0 && (
    <div className="alert alert-warn" role="status">
      <strong>Review flags — check these before deciding.</strong>
      <ul>{log.review_summary.anomalies.map((anomaly, index) => (
        <li key={`${anomaly.date || 'monthly'}-${anomaly.code}-${index}`}>{anomaly.date ? `${dateOnly(anomaly.date)} · ` : ''}{anomaly.message}</li>
      ))}</ul>
    </div>
  );
  const providerDetails = log && <>
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
  </>;
  const versionList = log && (log.versions.length ? (
    <div className="row">
      {log.versions.map((v) => (
        <button key={v.version} className="btn btn-secondary btn-sm" onClick={() => setVersion(v.version)}>
          Version {v.version} · {dateTime(v.created_at)}
        </button>
      ))}
    </div>
  ) : (
    <p className="muted">No frozen versions yet (created at CTC verification).</p>
  ));
  const timesheetIntro = <>
    <p className="muted small">The provider's timesheet in its standard form. Review it before recording a decision. Printing alone does not approve work.</p>
    {log && <PrintWorkLog logId={log.id} reviewLog={log} embedded />}
  </>;

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
          <ApprovalStepper status={log.status} audit={log.audit} hoursInStatus={log.hours_in_status} facilityEndorsed={log.endorsements.find((e) => e.version === log.version && e.kind === 'FACILITY_IN_CHARGE')?.actor_name} technicalReviewer={log.cadre?.technical_reviewer_title} communityOnly={!!log.assignment && !log.assignment.facility} workflowVersion={log.workflow_version} workType={log.work_type} financeTimesheetApproved={Boolean(timesheetApprovedAt)} />
          {showTimesheet && <ReviewSummary log={log} task={reviewTask} amount={summaryAmount} />}
          {!!log.review_feedback?.length && <Section title="Current review feedback">
            {log.review_feedback.map((feedback, index) => <div key={index}>
              {feedback.comment && <p>{feedback.comment}</p>}
              {!!feedback.details?.flags?.length && <FlagsList flags={feedback.details.flags} cadre={log.cadre} lang="en" />}
            </div>)}
          </Section>}
          {showTimesheet && flagsAlert}
          {showTimesheet && (timesheetFolded
            ? <Folded title={`Timesheet · approved ${dateTime(timesheetApprovedAt)}`}>{timesheetIntro}</Folded>
            : <Section title="Timesheet">{timesheetIntro}</Section>)}
          <ServiceTargets rows={log.service_targets} lang="en" />
          <Section title="Monthly provider summary">
            <div className="row">
              <span className="badge badge-neutral">Weekday daily limit: {log.review_summary?.limits.daily_hours} h</span>
              <span className="badge badge-neutral">Monday–Friday limit: {log.review_summary?.limits.weekly_hours} h</span>
              <span className="badge badge-neutral">Saturday clinics: {log.review_summary?.limits.saturday_min_hours}–{log.review_summary?.limits.saturday_max_hours} h, counted separately</span>
              <span className="badge badge-neutral">No Sunday work</span>
            </div>
            {(log.review_summary?.months || []).map((month) => (
              <div key={month.month} className="stack">
                <h4>{month.month} · {num(month.days)} days · {workHours(month.hours)} hours</h4>
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
            <p className="muted small">Pay-month totals (26th to 25th) include this provider's work logs visible within your permissions. The daily entries below belong to the selected log.</p>
            {!showTimesheet && flagsAlert}
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

          {!showTimesheet && <Section title="Header">{providerDetails}</Section>}

          {!financeSummaryOnly && <Section title={`Daily entries (${log.entries.length})`}>
            <EntriesView log={log} lang="en" />
            {!log.gps_visible && <p className="muted small">GPS coordinates are not shown for your role; only the location status is.</p>}
          </Section>}

          <TotalsPanel log={log} lang="en" title="Totals (server-calculated)" />

          {showTimesheet && <Folded title="Provider details">{providerDetails}</Folded>}

          {log.endorsements.length > 0 && (
            <Section title="Historical endorsements">
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

          {!financeSummaryOnly && (showTimesheet ? <Folded title="Versions">{versionList}</Folded> : <Section title="Versions">{versionList}</Section>)}

          {!timesheetStep && log.claims.length > 0 && (
            <Section title="Linked claims">
              {log.claims.some((claim) => claim.status === 'PENDING_FINANCE_REVIEW') && (
                <p className="notice notice-info">
                  RM authorization records the activity-rate amount for finance review. It is not routed or payable yet; Regional Finance confirms the funding source and fixed daily amount before routing.
                </p>
              )}
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {log.claims.map((c) => (
                  <li key={c.id} className="row">
                    <span>Claim #{c.id}{c.amount != null ? ` · ${c.currency || 'TZS'} ${num(c.amount)}` : ''}</span>
                    <StatusBadge kind="claim" status={c.status} /> <StatusBadge kind="payment" status={c.payment_status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!timesheetStep && log.workflow_version >= 2 && (
            <p className="notice notice-info">{log.work_type === 'PAYROLL'
              ? 'Payroll is a monthly work report. CTC verification, Technical review and RM approval remain required. No activity rate, budget, finance approval or payment routing is required.'
              : 'RM approval confirms the recorded work. Regional Finance confirms the funding source and fixed daily amount before routing.'}</p>
          )}
          {!timesheetStep && log.workflow_version === 2 && log.work_type !== 'PAYROLL' && log.financial_preview && (
            <Section title="Payment estimate">
              {log.work_type === 'SERVICES' && <p className="notice notice-info">Services use a fixed amount per service day. Only the highest eligible service amount on each date is payable. Unpriced work uses approved amounts effective on its work date; already priced work keeps its saved payment rules.</p>}
              <p className="muted small">Finance confirms the final payable amount. Later rate changes do not alter completed payments.</p>
              <PaymentSetupNotice exceptions={log.financial_preview.exceptions} workType={log.work_type} />
              {!financeSummaryOnly && <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Activity</th><th className="num">Units</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                  <tbody>{log.financial_preview.lines.map((line) => (
                    <tr key={line.entry_id}><td>{dateOnly(line.date)}</td><td>{line.activity}</td><td className="num">{line.units}</td><td className="num">{line.rate == null ? <span className="badge badge-warn">Rate missing</span> : `${line.rate}${line.currency ? ` ${line.currency}` : ''}`}</td><td className="num">{line.amount == null ? '—' : `${line.amount}${line.currency ? ` ${line.currency}` : ''}`}</td></tr>
                  ))}</tbody>
                </table>
              </div>}
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
                const fundingSource = fundingSources.data?.find((item) => String(item.id) === String(snapshot.funding_source_id));
                const category = typeof snapshot.category_name === 'string'
                  ? snapshot.category_name
                  : typeof snapshot.category === 'string'
                    ? snapshot.category
                    : snapshot.category && typeof snapshot.category === 'object' && 'name' in snapshot.category
                      ? String((snapshot.category as { name: unknown }).name)
                      : snapshot.category_id !== undefined && snapshot.category_id !== null
                          ? `Category #${String(snapshot.category_id)}`
                          : 'Not selected yet';
                return <>
                  {fundingSource && <p><strong>Funding source:</strong> {fundingSource.name}</p>}
                  {snapshot.payment_policy !== FIXED_DAILY_NO_BUDGET && <p><strong>Historical finance category:</strong> {category}</p>}
                  {snapshot.payment_policy === FIXED_DAILY_NO_BUDGET && <p><strong>Payment policy:</strong> Fixed daily amount · highest eligible amount per day · no budget allocation.</p>}
                  {snapshot.payment_policy === 'FIXED_DAILY_MONTHLY_REGIONAL_BUDGET' && <p><strong>Payment policy:</strong> Highest fixed service amount per day. The payable amount is deducted from this region’s budget for the dates worked when submitted to Central Finance. {hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'SUPER_ADMIN') && <a href="#/budgets">View monthly Services budgets</a>}.</p>}
                  {!financeSummaryOnly && lines.length > 0 && <div className="table-wrap"><table>
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
              {!financeSummaryOnly && <details><summary className="small">View full saved snapshot</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{JSON.stringify(log.finance_snapshot, null, 2)}</pre></details>}
            </Section>
          )}

          <AdminAudit><Section title="Audit trail">
            <AuditTimeline
              rows={log.audit.map((a) => ({
                ...a,
                extra: a.details?.flags?.length ? <FlagsList flags={a.details.flags} cadre={log.cadre} lang="en" /> : null,
              }))}
              actionLabels={WORKLOG_ACTION_LABELS}
              statusKind="log"
            />
          </Section></AdminAudit>

          {log.available_actions.length > 0 && (
            <Section title={decisionTitle}>
              <div ref={reviewMarker} aria-hidden="true" style={{ height: 1 }} />
              <p className="muted small">{decisionHelp}</p>
              {!reviewReached && <p className="notice notice-info">Scroll through the full work-log detail before confirming your review.</p>}
              {log.workflow_version === 2 && log.work_type === 'SERVICES' && (
                <div className="stack">
                  {(log.available_actions.includes('finance_review') || Boolean(log.finance_snapshot)) && <>
                    <Field label="Funding source" hint="Select the programme paying for this Services work.">
                      <select
                        required
                        value={fundingSourceId}
                        onChange={(event) => {
                          setFundingSourceId(event.target.value);
                        }}
                        disabled={fundingSources.loading || Boolean(fundingSources.error)}
                        aria-describedby="funding-source-status"
                      >
                        <option value="">Choose funding source…</option>
                        {availableFundingSources.map((source) => (
                          <option key={source.id} value={source.id}>{source.name} · {source.code}</option>
                        ))}
                      </select>
                    </Field>
                    <div id="funding-source-status">
                      {fundingSources.loading && <p className="muted small" role="status">Loading funding sources…</p>}
                      {fundingSources.error && <div className="stack"><Alert>{fundingSources.error}</Alert><button type="button" className="btn btn-secondary btn-sm" onClick={fundingSources.reload}>Retry funding sources</button></div>}
                      {!fundingSources.loading && !fundingSources.error && availableFundingSources.length === 0 && <p className="notice notice-warn">No PnP, Supply Chain or EpiC funding sources are available. Ask Central Finance to configure them before review.</p>}
                    </div>
                    {reviewedContextDirty && <p className="notice notice-warn" role="status">This differs from the saved finance review. Review these selections again before choosing a routing channel.</p>}
                    {log.available_actions.includes('finance_review') && hasLegacySnapshot && <p className="muted small">Re-review the funding source and fixed daily amount. Historical paid or committed records remain unchanged.</p>}
                  </>}
                </div>
              )}
              <label className="row">
                <input type="checkbox" checked={reviewConfirmed} disabled={!reviewReached} onChange={(e) => setReviewConfirmed(e.target.checked)} />
                <span>{confirmText}</span>
              </label>
              <div className="row">
                {log.available_actions.filter((a) => (!isRpmWithoutFinanceRole || !['route_fhi360', 'route_cso', 'paid'].includes(a)) && !(a === 'hold' && fixedDailyNoBudget)).map((a) => (
                  <button key={a} className={`btn ${DESTRUCTIVE_ACTIONS.has(a) ? 'btn-secondary' : 'btn-primary'}`} disabled={!reviewReached || !reviewConfirmed || (a === 'finance_review' && log.work_type === 'SERVICES' && !canSubmitServiceFinanceReview(fundingSourceId, availableFundingSources, reviewReached, reviewConfirmed)) || ((a === 'route_fhi360' || a === 'route_cso') && !canRouteReviewedFinanceContext(reviewedContextDirty))} onClick={() => setAction(a)}>
                    {decisionLabel(a)}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {showTimesheet && log.available_actions.length > 0 && (
            <div className="review-bar">
              <span>{reviewReached ? 'Tick the box above, then record your decision.' : 'Scroll to the end to finish review.'}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => reviewMarker.current?.scrollIntoView()}>Go to decision</button>
            </div>
          )}
        </div>
      )}

      {log && action && (
        <ReasonDialog
          title={decisionLabel(action)}
          description={regionalDecision && action === 'return' ? 'Send back to the Technical reviewer for this provider’s cadre and region. Technical and RM must review again before Finance.' : regionalDecision && action === 'reject' ? 'Reject to the provider for correction and resubmission through the work approval chain.' : ACTION_HELP[action]}
          required={WORKLOG_REASON_REQUIRED.has(action)}
          danger={DESTRUCTIVE_ACTIONS.has(action)}
          confirmLabel={decisionLabel(action)}
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
              <Field label="Central Finance reviewer" hint="Only this person can approve the Services handoff. Users must cover the provider’s region and cadre.">
                <select required value={centralReviewerId} onChange={event => setCentralReviewerId(event.target.value)} disabled={centralReviewers.loading || !!centralReviewers.error}>
                  <option value="">Choose Central Finance reviewer…</option>
                  {(centralReviewers.data || []).map(user => <option key={user.id} value={user.id}>{user.name} · {user.username}</option>)}
                </select>
              </Field>
              <Alert>{centralReviewers.error}</Alert>
              {centralReviewers.error && <button type="button" className="btn btn-secondary" onClick={centralReviewers.reload}>Retry Central Finance reviewers</button>}
              {!centralReviewers.loading && !centralReviewers.error && !centralReviewers.data?.length && <Alert kind="warn">No eligible Central Finance reviewer. Configure an active Central Finance user with this region and cadre before routing.</Alert>}
              {!payors.loading && !payors.error && payors.data?.eligible_payors.length === 0 && <p className="muted small">No eligible destination is available. Resolve the routing exception before channeling.</p>}
            </div>
          )}
        </ReasonDialog>
      )}
      {log && version !== null && <VersionModal log={log} version={version} onClose={() => setVersion(null)} />}
    </Drawer>
  );
}
