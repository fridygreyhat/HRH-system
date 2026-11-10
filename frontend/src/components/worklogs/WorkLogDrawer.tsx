import { ApprovalStepper } from './ApprovalStepper';
import { PrintWorkLog } from '../../pages/PrintWorkLog';
import { ServiceTargets } from './ServiceTargets';
import { PaymentSetupNotice } from './PaymentSetupNotice';
import { AdminAudit } from '../AdminAudit';
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../AuthContext';
import {
  CADRE_NAMES,
  cadreName,
  dateOnly,
  dateTime,
  datesBetween,
  DESTRUCTIVE_ACTIONS,
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
import { Alert, AuditTimeline, DevCodeNotice, Drawer, Facts, Field, Modal, ReasonDialog, Section, StatusBadge, WorkTypeChip } from '../ui';
import { Icon } from '../Icon';
import { ageText, EntriesView, FLAG_GENERAL_FIELDS, FlagsList, TotalsPanel, WORKLOG_ACTION_LABELS_SW } from './shared';
import '../../pages/polish-review.css';
import { buildServiceFinanceReviewPayload, canRouteReviewedFinanceContext, canSubmitServiceFinanceReview, FIXED_DAILY_NO_BUDGET, reviewedFinanceContextChanged, supportedServiceFundingSources } from './FundingReview';

const ACTION_HELP_SW: Record<string, string> = {
  verify: 'Inathibitisha kazi na kufunga toleo hili.',
  endorse: 'Idhinisha toleo lililohakikiwa.',
  authorize: 'Idhinisha kazi iliyorekodiwa. Hii si malipo.',
  return: 'Rudisha kwa mtoa huduma. Mapitio yanaanza upya akiwasilisha tena.',
  return_to_reviewer: 'Rudisha kwa hatua ya mapitio iliyotangulia.',
  reject: 'Kataa jedwali hili kabisa.',
  hold: 'Weka dai hili la kihistoria kwenye zuio.',
  release: 'Ondoa zuio la kihistoria; linarudi kwa idhini ya RM.',
  reopen: 'Fungua tena kwa marekebisho. Ghairi madai yaliyounganishwa kwanza.',
  finance_timesheet_approve: 'Idhinisha jedwali. Malipo ya Huduma yanakaguliwa baadaye.',
  finance_review: 'Thibitisha chanzo cha fedha na kiasi cha kila siku.',
};

const ACTION_HELP: Record<string, string> = {
  verify: 'Confirms the work and freezes this version.',
  endorse: 'Endorse the verified version.',
  authorize: 'Authorize the recorded work. This is not payment.',
  return: 'Send back to the provider. Review restarts on resubmission.',
  return_to_reviewer: 'Send back to the previous review stage.',
  reject: 'Final rejection of this work log.',
  hold: 'Place this historical claim on hold.',
  release: 'Release this historical hold back to RM authorization.',
  reopen: 'Reopen for correction. Cancel linked claims first.',
  finance_timesheet_approve: 'Approve the timesheet. Services payment is reviewed next.',
  finance_review: 'Confirm the funding source and daily amount.',
};

function actionDisplayLabel(action: string, hasFinanceSnapshot: boolean, sw = false): string {
  if (action === 'finance_review') return sw ? (hasFinanceSnapshot ? 'Kagua tena malipo ya Huduma' : 'Idhinisha malipo ya Huduma') : hasFinanceSnapshot ? 'Re-review Services payment' : 'Approve Services payment';
  if (action === 'release') return sw ? 'Ondoa zuio la kihistoria' : 'Release historical hold';
  if (action === 'hold') return sw ? 'Weka dai la kihistoria kwenye zuio' : 'Place historical claim on hold';
  return (sw && WORKLOG_ACTION_LABELS_SW[action]) || WORKLOG_ACTION_LABELS[action] || humanize(action);
}

/** Closed by default: reference details the reviewer opens only when needed. */
function Folded({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return <details className="card folded"><summary>{title}</summary><div className="stack">{children}</div></details>;
}

/** The reviewer's task and key numbers, shown before the timesheet. */
function ReviewSummary({ log, task, amount, sw, active }: { log: WorkLogDetail; task: string; amount: string | null; sw: boolean; active: boolean }) {
  const flagCount = log.review_summary?.anomalies?.length || 0;
  const items: [string, string][] = [
    [sw ? 'Siku' : 'Days', num(log.totals.days)],
    [sw ? 'Masaa' : 'Hours', workHours(log.totals.hours)],
    [sw ? 'Alama' : 'Flags', num(flagCount)],
    ...(amount ? [[sw ? 'Kiasi' : 'Amount', amount] as [string, string]] : []),
  ];
  return (
    <section className={`card review-summary${active ? ' review-summary-active' : ''}${flagCount ? ' review-summary-flagged' : ''}`} aria-label={sw ? 'Muhtasari wa mapitio' : 'Review summary'}>
      <p className="review-task">{task}</p>
      <dl>{items.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    </section>
  );
}

function FlagEditor({ log, flags, onChange }: { log: WorkLogDetail; flags: ReturnFlag[]; onChange: (f: ReturnFlag[]) => void }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const fieldName = (key: string) => {
    const general = FLAG_GENERAL_FIELDS.find((g) => g.key === key);
    if (general) return sw ? general.sw : general.en;
    const field = log.cadre.fields.find((c) => c.key === key);
    return field ? (sw && field.label_sw) || field.label_en : key;
  };
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
      <legend>{sw ? 'Weka alama kwenye tarehe na sehemu maalum (si lazima)' : 'Flag specific dates and fields (optional)'}</legend>
      <div className="flag-row">
        <Field label={sw ? 'Tarehe' : 'Date'}>
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {datesBetween(log.period.start_date, log.period.end_date).map((d) => (
              <option key={d} value={d}>
                {dateOnly(d)}
                {entryDates.has(d) ? '' : sw ? ' (hakuna taarifa)' : ' (no entry)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label={sw ? 'Sehemu' : 'Field'}>
          <select value={field} onChange={(e) => setField(e.target.value)}>
            {FLAG_GENERAL_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {sw ? f.sw : f.en}
              </option>
            ))}
            {log.cadre.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {(sw && f.label_sw) || f.label_en}
              </option>
            ))}
          </select>
        </Field>
        <Field label={sw ? 'Maelezo' : 'Note'}>
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button type="button" className="btn btn-secondary" onClick={add}>
          {sw ? 'Ongeza alama' : 'Add flag'}
        </button>
      </div>
      {flags.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
          {flags.map((f, i) => (
            <li key={`${f.entry_date}-${f.field}-${i}`}>
              {dateOnly(f.entry_date)} · {fieldName(f.field)}
              {f.note ? `: ${f.note}` : ''}{' '}
              <button type="button" className="link small" onClick={() => onChange(flags.filter((_, j) => j !== i))}>
                {sw ? 'ondoa' : 'remove'}
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
  const { lang } = useAuth();
  const sw = lang === 'sw';
  return (
    <Modal title={sw ? `Toleo ${version} (lilifungwa wakati wa uhakiki wa CTC)` : `Version ${version} (frozen at CTC verification)`} onClose={onClose}>
      <Alert>{error}</Alert>
      {loading && !data && <p className="muted">{sw ? 'Inapakia…' : 'Loading…'}</p>}
      {s && (
        <div className="stack">
          <p className="muted small">
            {sw ? 'Lilifungwa' : 'Frozen'} {dateTime(data.created_at)} · {s.staff.name} · {s.cadre} · {s.period.label || `${s.period.start} – ${s.period.end}`}
            {s.occupation ? ` · ${s.occupation}${s.occupation_other ? ` (${s.occupation_other})` : ''}` : ''}
            {s.section ? ` · ${s.section}` : ''}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{sw ? 'Tarehe' : 'Date'}</th>
                  <th className="num">{sw ? 'Masaa' : 'Hours'}</th>
                  {log.cadre.fields.map((f) => (
                    <th key={f.key} className="num">
                      {(sw && f.label_sw) || f.label_en}
                    </th>
                  ))}
                  <th>{sw ? 'Ushahidi' : 'Evidence'}</th>
                  <th>{sw ? 'Mahali' : 'Location'}</th>
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
                        {e.measures[f.key] === undefined ? '—' : f.field_type === 'BOOLEAN' ? (Number(e.measures[f.key]) ? (sw ? 'Ndiyo' : 'Yes') : sw ? 'Hapana' : 'No') : num(e.measures[f.key])}
                      </td>
                    ))}
                    <td>{e.evidence}</td>
                    <td className="small">{label(LOCATION_LABELS, e.location_status)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{sw ? `Jumla (siku ${num(s.totals.days)})` : `Total (${num(s.totals.days)} days)`}</th>
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
          {s.period_comment && <p className="small">{sw ? 'Maoni ya kipindi' : 'Period comment'}: {s.period_comment}</p>}
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
  const { hasRole, lang: authLang } = useAuth();
  const lang = authLang === 'sw' ? 'sw' : 'en';
  const sw = lang === 'sw';
  const tr = (en: string, swText: string) => (sw ? swText : en);
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
  const decisionTitle = timesheetStep ? tr('Review 1 of 2 · Timesheet', 'Mapitio 1 kati ya 2 · Jedwali')
    : paymentStep ? tr('Review 2 of 2 · Services payment', 'Mapitio 2 kati ya 2 · Malipo ya Huduma')
      : routingActionAvailable ? tr('Send to Central Finance', 'Tuma kwa Fedha Kuu') : tr('Review and decide', 'Pitia na uamue');
  const decisionLabel = (value: string) => value === 'verify' && log?.assignment && !log.assignment.facility ? tr('Verify and approve (CSO Technical)', 'Hakiki na idhinisha (Kitaalamu wa CSO)')
    : regionalDecision && value === 'return' ? tr('Return to cadre Technical', 'Rudisha kwa Kitaalamu wa kada')
    : regionalDecision && value === 'reject' ? tr('Reject to provider', 'Kataa kwa mtoa huduma') : actionDisplayLabel(value, Boolean(log?.finance_snapshot), sw);
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
        if (!targetPayorId) throw new Error(tr('Choose the destination payor before channeling this work log.', 'Chagua mlipaji kabla ya kutuma jedwali hili.'));
        if (!centralReviewerId) throw new Error(tr('Choose a named Central Finance reviewer before routing these Services.', 'Chagua mkaguzi wa Fedha Kuu kabla ya kutuma Huduma hizi.'));
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
        setNotice(`${tr('Channelled to', 'Imetumwa kwa')} ${result.payor_name} · ${result.currency} ${result.amount}.`);
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
      setNotice(action === 'finance_timesheet_approve' ? tr('Timesheet approved. Now review the Services payment.', 'Jedwali limeidhinishwa. Sasa kagua malipo ya Huduma.') : `${decisionLabel(action)}: ${tr('done.', 'imekamilika.')}`);
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
  const reviewTask = timesheetStep ? tr('Your turn: approve the timesheet (review 1 of 2)', 'Zamu yako: idhinisha jedwali (mapitio 1 kati ya 2)')
    : paymentStep ? tr('Your turn: approve the Services payment (review 2 of 2)', 'Zamu yako: idhinisha malipo ya Huduma (mapitio 2 kati ya 2)')
      : routingActionAvailable ? tr('Your turn: send to Central Finance', 'Zamu yako: tuma kwa Fedha Kuu')
        : log?.available_actions.length ? tr('Your turn: review and decide', 'Zamu yako: pitia na uamue') : tr('No action needed from you', 'Hakuna hatua inayohitajika kwako');
  const decisionHelp = timesheetStep ? tr('Check the timesheet, totals and flags above.', 'Kagua jedwali, jumla na alama hapo juu.')
    : paymentStep ? tr('Check the funding source and daily amount.', 'Kagua chanzo cha fedha na kiasi cha kila siku.')
      : financeSummaryOnly ? tr('Check the timesheet, totals and payment setup above.', 'Kagua jedwali, jumla na mpangilio wa malipo hapo juu.')
        : tr('Review everything above before deciding.', 'Pitia kila kitu hapo juu kabla ya kuamua.');
  const confirmText = timesheetStep ? tr('I have checked the timesheet, totals and flags.', 'Nimekagua jedwali, jumla na alama.')
    : paymentStep ? tr('I have checked the funding source and payment amount.', 'Nimekagua chanzo cha fedha na kiasi cha malipo.')
      : financeSummaryOnly ? tr('I have checked the timesheet, totals and payment setup.', 'Nimekagua jedwali, jumla na mpangilio wa malipo.') : tr('I have checked all entries and the monthly summary.', 'Nimekagua taarifa zote za siku na muhtasari wa mwezi.');
  const fieldLabel = (field: { label_en: string; label_sw?: string | null }) => (sw && field.label_sw) || field.label_en;
  const cadreLabel = log ? (CADRE_NAMES[log.cadre.code] ? cadreName(log.cadre.code, lang) : log.cadre.name) : '';
  const place = log ? [log.assignment?.facility || log.assignment?.community_area, log.assignment?.region].filter(Boolean).join(' · ') : '';
  const flagsAlert = log && log.review_summary?.anomalies?.length > 0 && (
    <div className="alert alert-warn" role="status">
      <strong>{tr('Review flags', 'Alama za mapitio')}</strong>
      <ul>{log.review_summary.anomalies.map((anomaly, index) => (
        <li key={`${anomaly.date || 'monthly'}-${anomaly.code}-${index}`}>{anomaly.date ? `${dateOnly(anomaly.date)} · ` : ''}{anomaly.message}</li>
      ))}</ul>
    </div>
  );
  const providerDetails = log && <>
    <Facts
      items={[
        [tr('Provider', 'Mtoa huduma'), log.staff.name],
        [tr('Cadre', 'Kada'), `${cadreLabel} (${log.cadre.code})`],
        [tr('Occupation', 'Kazi'), log.occupation ? `${log.occupation}${log.occupation_other ? ` – ${log.occupation_other}` : ''}` : null],
        [tr('Section', 'Sehemu'), log.section],
        [tr('Salary scale', 'Daraja la mshahara'), log.staff.salary_scale],
        [tr('Region', 'Mkoa'), log.assignment?.region],
        [tr('District', 'Wilaya'), log.assignment?.district],
        [tr('Ward', 'Kata'), log.assignment?.ward],
        [tr('Facility', 'Kituo'), log.assignment?.facility],
        [tr('Community area', 'Eneo la jamii'), log.assignment?.community_area],
        [tr('Period', 'Kipindi'), `${dateOnly(log.period.start_date)} – ${dateOnly(log.period.end_date)}`],
        [tr('Submitted', 'Imewasilishwa'), dateTime(log.submitted_at)],
        [tr('Attested', 'Amethibitisha'), dateTime(log.attested_at)],
        [tr('Provider confirmed version', 'Toleo alilothibitisha mtoa huduma'), log.confirmed_version],
      ]}
    />
    {log.period_comment && <p className="small">{tr('Period comment', 'Maoni ya kipindi')}: “{log.period_comment}”</p>}
  </>;
  const versionList = log && (log.versions.length ? (
    <div className="row">
      {log.versions.map((v) => (
        <button key={v.version} className="btn btn-secondary btn-sm" onClick={() => setVersion(v.version)}>
          {tr('Version', 'Toleo')} {v.version} · {dateTime(v.created_at)}
        </button>
      ))}
    </div>
  ) : (
    <p className="muted">{tr('No frozen versions yet.', 'Bado hakuna matoleo yaliyofungwa.')}</p>
  ));
  const timesheetIntro = <>
    {log && <PrintWorkLog logId={log.id} reviewLog={log} embedded />}
  </>;

  return (
    <Drawer title={log ? <span className="wl-title">{log.staff_name}<span className="wl-title-month">{log.period_label}</span></span> : `${tr('Work log', 'Jedwali')} #${logId}`} onClose={onClose} wide>
      <Alert>{error}</Alert>
      {!log && loading && <p className="muted">{tr('Loading…', 'Inapakia…')}</p>}
      {log && (
        <div className="stack-lg wl-review">
          <section className="wl-head" aria-label={tr('Timesheet header', 'Kichwa cha jedwali')}>
            <div className="wl-head-main">
              <span className="wl-head-cadre">{cadreLabel}</span>
              {place && <span className="wl-head-place">{place}</span>}
            </div>
            <div className="wl-head-badges">
              <StatusBadge kind="log" status={log.status} bare />
              <WorkTypeChip type={log.work_type} />
              <span className="chip chip-quiet"><Icon name="calendar" size={13} /> {log.period_label}</span>
              <span className="badge badge-neutral">{tr('Version', 'Toleo')} {log.version}</span>
              <span className={`badge ${log.hours_in_status > 48 ? 'badge-danger' : 'badge-neutral'}`}>{tr('In status', 'Katika hali hii')} {ageText(log.hours_in_status, lang)}</span>
            </div>
            <button type="button" className="btn btn-secondary btn-sm wl-head-print" onClick={() => navigate('print', log.id)}>
              <Icon name="table" size={15} /> {tr('Print view', 'Chapisha')}
            </button>
          </section>
          <ApprovalStepper status={log.status} audit={log.audit} hoursInStatus={log.hours_in_status} facilityEndorsed={log.endorsements.find((e) => e.version === log.version && e.kind === 'FACILITY_IN_CHARGE')?.actor_name} technicalReviewer={log.cadre?.technical_reviewer_title} communityOnly={!!log.assignment && !log.assignment.facility} workflowVersion={log.workflow_version} workType={log.work_type} financeTimesheetApproved={Boolean(timesheetApprovedAt)} />
          {showTimesheet && <ReviewSummary log={log} task={reviewTask} amount={summaryAmount} sw={sw} active={log.available_actions.length > 0} />}
          {!!log.review_feedback?.length && <Section title={tr('Current review feedback', 'Maoni ya mapitio ya sasa')}>
            {log.review_feedback.map((feedback, index) => <div key={index}>
              {feedback.comment && <p>{feedback.comment}</p>}
              {!!feedback.details?.flags?.length && <FlagsList flags={feedback.details.flags} cadre={log.cadre} lang={lang} />}
            </div>)}
          </Section>}
          {showTimesheet && flagsAlert}
          {showTimesheet && (timesheetFolded
            ? <Folded title={`${tr('Timesheet · approved', 'Jedwali · limeidhinishwa')} ${dateTime(timesheetApprovedAt)}`}>{timesheetIntro}</Folded>
            : <Section title={tr('Timesheet', 'Jedwali')}>{timesheetIntro}</Section>)}
          <ServiceTargets rows={log.service_targets} lang={lang} />
          <Section title={tr('Monthly provider summary', 'Muhtasari wa mwezi wa mtoa huduma')}>
            <div className="row">
              <span className="badge badge-neutral">{tr('Weekday daily limit', 'Kikomo cha kila siku ya kazi')}: {log.review_summary?.limits.daily_hours} h</span>
              <span className="badge badge-neutral">{tr('Monday–Friday limit', 'Kikomo cha Jumatatu–Ijumaa')}: {log.review_summary?.limits.weekly_hours} h</span>
              <span className="badge badge-neutral">{tr('Saturday clinics', 'Kliniki za Jumamosi')}: {log.review_summary?.limits.saturday_min_hours}–{log.review_summary?.limits.saturday_max_hours} h</span>
              <span className="badge badge-neutral">{tr('No Sunday work', 'Hakuna kazi Jumapili')}</span>
            </div>
            {(log.review_summary?.months || []).map((month) => (
              <div key={month.month} className="stack">
                <h4>{month.month} · {num(month.days)} {tr('days', 'siku')} · {workHours(month.hours)} {tr('hours', 'masaa')}</h4>
                <dl className="totals-list">
                  {log.cadre.fields.filter((field) => Number(month.metrics[field.key] ?? 0) > 0).map((field) => (
                    <div key={field.key}>
                      <dt>{fieldLabel(field)}</dt>
                      <dd>{num(Number(month.metrics[field.key]))}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <p className="muted small">{tr('Pay-month totals (26th to 25th).', 'Jumla za mwezi wa malipo (tarehe 26 hadi 25).')}</p>
            {!showTimesheet && flagsAlert}
          </Section>
          {conflict && (
            <div className="alert alert-warn" role="alert">
              {tr('This work log changed since you opened it, so your action was not applied. Reload and review it again.', 'Jedwali hili limebadilika tangu ulipolifungua, kwa hiyo hatua yako haikutekelezwa. Pakia upya na ulipitie tena.')}{' '}
              <button className="btn btn-secondary btn-sm" onClick={reloadAfterConflict}>
                {tr('Reload', 'Pakia upya')}
              </button>
            </div>
          )}
          <Alert kind="success">{notice}</Alert>
          <DevCodeNotice code={devOtp} label={tr('Provider code (test mode only)', 'Namba ya mtoa huduma (majaribio tu)')} />

          {log.location_exception_count > 0 && (
            <p className="notice">
              {sw ? `Siku ${log.location_exception_count} zina tofauti ya mahali ya kukagua.` : `${log.location_exception_count} day(s) have a location exception to review.`}
            </p>
          )}

          {!showTimesheet && <Section title={tr('Header', 'Taarifa za jedwali')}>{providerDetails}</Section>}

          {!financeSummaryOnly && <Section title={`${tr('Daily entries', 'Taarifa za kila siku')} (${log.entries.length})`}>
            <EntriesView log={log} lang={lang} />
          </Section>}

          <TotalsPanel log={log} lang={lang} title={tr('Totals', 'Jumla')} />

          {showTimesheet && <Folded title={tr('Provider details', 'Taarifa za mtoa huduma')}>{providerDetails}</Folded>}

          {log.endorsements.length > 0 && (
            <Section title={tr('Historical endorsements', 'Idhini za kihistoria')}>
              {log.endorsements.length ? (
                <ul className="small">
                  {log.endorsements.map((e) => (
                    <li key={e.id}>
                      {humanize(e.kind)} {tr('by', 'na')} {e.actor_name} ({tr('version', 'toleo')} {e.version}){e.created_at ? ` · ${dateTime(e.created_at)}` : ''}
                      {e.comment ? ` – “${e.comment}”` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{tr('None recorded.', 'Hakuna iliyorekodiwa.')}</p>
              )}
            </Section>
          )}

          {!financeSummaryOnly && (showTimesheet ? <Folded title={tr('Versions', 'Matoleo')}>{versionList}</Folded> : <Section title={tr('Versions', 'Matoleo')}>{versionList}</Section>)}

          {!timesheetStep && log.claims.length > 0 && (
            <Section title={tr('Linked claims', 'Madai yaliyounganishwa')}>
              {log.claims.some((claim) => claim.status === 'PENDING_FINANCE_REVIEW') && (
                <p className="notice notice-info">{tr('Awaiting Regional Finance review. Not payable yet.', 'Inasubiri mapitio ya Fedha ya Mkoa. Bado haiwezi kulipwa.')}</p>
              )}
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {log.claims.map((c) => (
                  <li key={c.id} className="row">
                    <span>{tr('Claim', 'Dai')} #{c.id}{c.amount != null ? ` · ${c.currency || 'TZS'} ${num(c.amount)}` : ''}</span>
                    <StatusBadge kind="claim" status={c.status} /> <StatusBadge kind="payment" status={c.payment_status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!timesheetStep && log.workflow_version === 2 && log.work_type !== 'PAYROLL' && log.financial_preview && (
            <Section title={tr('Payment estimate', 'Makadirio ya malipo')}>
              <p className="muted small">{tr('Estimate only. Finance confirms the final amount.', 'Makadirio tu. Fedha huthibitisha kiasi cha mwisho.')}</p>
              <PaymentSetupNotice exceptions={log.financial_preview.exceptions} workType={log.work_type} />
              {!financeSummaryOnly && <div className="table-wrap">
                <table>
                  <thead><tr><th>{tr('Date', 'Tarehe')}</th><th>{tr('Activity', 'Shughuli')}</th><th className="num">{tr('Units', 'Vipimo')}</th><th className="num">{tr('Rate', 'Kiwango')}</th><th className="num">{tr('Amount', 'Kiasi')}</th></tr></thead>
                  <tbody>{log.financial_preview.lines.map((line) => (
                    <tr key={line.entry_id}><td className="nowrap">{dateOnly(line.date)}</td><td>{line.activity}</td><td className="num">{line.units}</td><td className="num">{line.rate == null ? <span className="badge badge-warn">{tr('Rate missing', 'Kiwango hakipo')}</span> : `${line.rate}${line.currency ? ` ${line.currency}` : ''}`}</td><td className="num nowrap">{line.amount == null ? '—' : `${line.amount}${line.currency ? ` ${line.currency}` : ''}`}</td></tr>
                  ))}</tbody>
                </table>
              </div>}
              <p><strong>{tr('Total', 'Jumla')}: {log.financial_preview.total} {log.financial_preview.currency || ''}</strong></p>
            </Section>
          )}
          {log.workflow_version === 2 && log.finance_snapshot && (
            <Section title={tr('Finance snapshot · immutable', 'Kumbukumbu ya Fedha · haibadiliki')}>
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
                          ? `${tr('Category', 'Kundi')} #${String(snapshot.category_id)}`
                          : tr('Not selected yet', 'Bado halijachaguliwa');
                return <>
                  {fundingSource && <p><strong>{tr('Funding source', 'Chanzo cha fedha')}:</strong> {fundingSource.name}</p>}
                  {snapshot.payment_policy !== FIXED_DAILY_NO_BUDGET && <p><strong>{tr('Historical finance category', 'Kundi la fedha la kihistoria')}:</strong> {category}</p>}
                  {snapshot.payment_policy === FIXED_DAILY_NO_BUDGET && <p><strong>{tr('Payment policy', 'Sera ya malipo')}:</strong> {tr('Fixed daily amount · highest eligible amount per day · no budget allocation.', 'Kiasi maalum cha kila siku · kiasi cha juu kinachostahili kwa siku · bila mgao wa bajeti.')}</p>}
                  {snapshot.payment_policy === 'FIXED_DAILY_MONTHLY_REGIONAL_BUDGET' && <p><strong>{tr('Payment policy', 'Sera ya malipo')}:</strong> {tr('Highest fixed amount per day · deducted from the regional budget.', 'Kiasi cha juu kwa siku · kinakatwa kwenye bajeti ya mkoa.')} {hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'SUPER_ADMIN') && <a href="#/budgets">{tr('View monthly Services budgets', 'Tazama bajeti za Huduma za mwezi')}</a>}.</p>}
                  {!financeSummaryOnly && lines.length > 0 && <div className="table-wrap"><table>
                    <thead><tr><th>{tr('Date', 'Tarehe')}</th><th>{tr('Activity / component', 'Shughuli / sehemu')}</th><th className="num">{tr('Units', 'Vipimo')}</th><th className="num">{tr('Rate', 'Kiwango')}</th><th className="num">{tr('Amount', 'Kiasi')}</th></tr></thead>
                    <tbody>{lines.map((line, index) => <tr key={String(line.entry_id ?? line.id ?? index)}>
                      <td className="nowrap">{String(line.date ?? '—')}</td>
                      <td>{String(line.activity ?? line.component_name ?? line.component ?? '—')}</td>
                      <td className="num">{String(line.units ?? '—')}</td>
                      <td className="num">{line.rate == null ? <span className="badge badge-warn">{tr('Rate missing', 'Kiwango hakipo')}</span> : String(line.rate)}</td>
                      <td className="num nowrap">{line.amount == null ? '—' : `${String(line.amount)}${line.currency ? ` ${String(line.currency)}` : ''}`}</td>
                    </tr>)}</tbody>
                  </table></div>}
                  {snapshot.total !== undefined && <p><strong>{tr('Saved total', 'Jumla iliyohifadhiwa')}:</strong> {String(snapshot.total)} {String(snapshot.currency || '')}</p>}
                </>;
              })()}
              {!financeSummaryOnly && <details><summary className="small">{tr('View full saved snapshot', 'Tazama kumbukumbu yote iliyohifadhiwa')}</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{JSON.stringify(log.finance_snapshot, null, 2)}</pre></details>}
            </Section>
          )}

          <AdminAudit><Section title={tr('Audit trail', 'Historia ya ukaguzi')}>
            <AuditTimeline
              rows={log.audit.map((a) => ({
                ...a,
                extra: a.details?.flags?.length ? <FlagsList flags={a.details.flags} cadre={log.cadre} lang={lang} /> : null,
              }))}
              actionLabels={sw ? { ...WORKLOG_ACTION_LABELS, ...WORKLOG_ACTION_LABELS_SW } : WORKLOG_ACTION_LABELS}
              statusKind="log"
            />
          </Section></AdminAudit>

          {log.available_actions.length > 0 && (
            <Section title={decisionTitle} className="wl-decision">
              <div ref={reviewMarker} aria-hidden="true" style={{ height: 1 }} />
              <p className="muted small">{decisionHelp}</p>
              {!reviewReached && <p className="notice notice-info">{tr('Scroll to the end before confirming.', 'Sogeza hadi mwisho kabla ya kuthibitisha.')}</p>}
              {log.workflow_version === 2 && log.work_type === 'SERVICES' && (
                <div className="stack">
                  {(log.available_actions.includes('finance_review') || Boolean(log.finance_snapshot)) && <>
                    <Field label={tr('Funding source', 'Chanzo cha fedha')}>
                      <select
                        required
                        value={fundingSourceId}
                        onChange={(event) => {
                          setFundingSourceId(event.target.value);
                        }}
                        disabled={fundingSources.loading || Boolean(fundingSources.error)}
                        aria-describedby="funding-source-status"
                      >
                        <option value="">{tr('Choose funding source…', 'Chagua chanzo cha fedha…')}</option>
                        {availableFundingSources.map((source) => (
                          <option key={source.id} value={source.id}>{source.name} · {source.code}</option>
                        ))}
                      </select>
                    </Field>
                    <div id="funding-source-status">
                      {fundingSources.loading && <p className="muted small" role="status">{tr('Loading funding sources…', 'Inapakia vyanzo vya fedha…')}</p>}
                      {fundingSources.error && <div className="stack"><Alert>{fundingSources.error}</Alert><button type="button" className="btn btn-secondary btn-sm" onClick={fundingSources.reload}>{tr('Retry funding sources', 'Jaribu tena vyanzo vya fedha')}</button></div>}
                      {!fundingSources.loading && !fundingSources.error && availableFundingSources.length === 0 && <p className="notice notice-warn">{tr('No PnP, Supply Chain or EpiC funding sources. Ask Central Finance to add them.', 'Hakuna vyanzo vya fedha vya PnP, Supply Chain au EpiC. Omba Fedha Kuu waviongeze.')}</p>}
                    </div>
                    {reviewedContextDirty && <p className="notice notice-warn" role="status">{tr('This differs from the saved finance review. Review again before routing.', 'Hii ni tofauti na mapitio ya Fedha yaliyohifadhiwa. Kagua tena kabla ya kutuma.')}</p>}
                    {log.available_actions.includes('finance_review') && hasLegacySnapshot && <p className="muted small">{tr('Re-review the funding source and daily amount.', 'Kagua tena chanzo cha fedha na kiasi cha kila siku.')}</p>}
                  </>}
                </div>
              )}
              <label className={`row wl-confirm${reviewConfirmed ? ' is-checked' : ''}`}>
                <input type="checkbox" checked={reviewConfirmed} disabled={!reviewReached} onChange={(e) => setReviewConfirmed(e.target.checked)} />
                <span>{confirmText}</span>
              </label>
              <div className="row wl-actions">
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
              <span>{reviewReached ? tr('Tick the box, then decide.', 'Weka alama kwenye kisanduku, kisha uamue.') : tr('Scroll to the end to finish review.', 'Sogeza hadi mwisho kumaliza mapitio.')}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => reviewMarker.current?.scrollIntoView()}>{tr('Go to decision', 'Nenda kwenye uamuzi')}</button>
            </div>
          )}
        </div>
      )}

      {log && action && (
        <ReasonDialog
          title={decisionLabel(action)}
          description={regionalDecision && action === 'return'
            ? tr('Send back to the cadre Technical reviewer. Technical and RM review again.', 'Rudisha kwa mkaguzi wa Kitaalamu wa kada. Kitaalamu na RM watapitia tena.')
            : regionalDecision && action === 'reject'
              ? tr('Reject to the provider for correction and resubmission.', 'Kataa kwa mtoa huduma ili arekebishe na awasilishe tena.')
              : (sw && ACTION_HELP_SW[action]) || ACTION_HELP[action]}
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
              {payors.error && <button type="button" className="btn btn-secondary btn-sm" onClick={payors.reload}>{tr('Retry eligible payors', 'Jaribu tena walipaji')}</button>}
              {payors.loading && <p className="muted small" role="status">{tr('Loading eligible payors…', 'Inapakia walipaji wanaostahili…')}</p>}
              {payors.data?.routing_exception && <div className="alert alert-warn" role="alert">{payors.data.routing_exception}</div>}
              <Field label={tr('Destination payor', 'Mlipaji')}>
                <select required value={targetPayorId} onChange={(event) => setTargetPayorId(event.target.value)} disabled={payors.loading || Boolean(payors.error)}>
                  <option value="">{tr('Choose destination payor…', 'Chagua mlipaji…')}</option>
                  {(payors.data?.eligible_payors || []).map((payor) => <option key={payor.id} value={payor.id}>{payor.name} · {payor.type}</option>)}
                </select>
              </Field>
              <Field label={tr('Central Finance reviewer', 'Mkaguzi wa Fedha Kuu')} hint={tr('Only this person can approve the handoff.', 'Ni mtu huyu tu anayeweza kuidhinisha makabidhiano.')}>
                <select required value={centralReviewerId} onChange={event => setCentralReviewerId(event.target.value)} disabled={centralReviewers.loading || !!centralReviewers.error}>
                  <option value="">{tr('Choose Central Finance reviewer…', 'Chagua mkaguzi wa Fedha Kuu…')}</option>
                  {(centralReviewers.data || []).map(user => <option key={user.id} value={user.id}>{user.name} · {user.username}</option>)}
                </select>
              </Field>
              <Alert>{centralReviewers.error}</Alert>
              {centralReviewers.error && <button type="button" className="btn btn-secondary" onClick={centralReviewers.reload}>{tr('Retry Central Finance reviewers', 'Jaribu tena wakaguzi wa Fedha Kuu')}</button>}
              {!centralReviewers.loading && !centralReviewers.error && !centralReviewers.data?.length && <Alert kind="warn">{tr('No eligible Central Finance reviewer for this region and cadre.', 'Hakuna mkaguzi wa Fedha Kuu anayestahili kwa mkoa na kada hii.')}</Alert>}
              {!payors.loading && !payors.error && payors.data?.eligible_payors.length === 0 && <p className="muted small">{tr('No eligible destination. Resolve the routing exception first.', 'Hakuna mlipaji anayestahili. Tatua tatizo la utumaji kwanza.')}</p>}
            </div>
          )}
        </ReasonDialog>
      )}
      {log && version !== null && <VersionModal log={log} version={version} onClose={() => setVersion(null)} />}
    </Drawer>
  );
}
