import React from 'react';
import { useAuth } from '../../AuthContext';
import { dateTime } from '../../format';
import { WorkLogAudit } from '../../types';
import { Icon } from '../Icon';
import { ageText } from './shared';
import '../../pages/polish-review.css';

/**
 * Visual map of the approval journey every cadre follows. Historical provider confirmations remain
 * visible in the audit cycle; when confirmation is disabled the stage is omitted from active flows.
 * Who acted and when comes from the audit trail of the current submission cycle.
 */
const ALL_STEPS = [
  { action: 'submit', en: 'Submitted', sw: 'Imewasilishwa', who: { en: 'Provider', sw: 'Mtoa huduma' } },
  { action: 'verify', en: 'CTC verification', sw: 'Uhakiki wa CTC', who: { en: 'CTC In-Charge', sw: 'Mkuu wa CTC' } },
  { action: 'confirm_otp', en: 'Provider confirmation', sw: 'Uthibitisho wa mtoa huduma', who: { en: 'SMS code', sw: 'Namba ya SMS' } },
  { action: 'endorse', en: 'Technical review', sw: 'Mapitio ya kitaalamu', who: { en: 'Technical Officer', sw: 'Afisa wa kitaalamu' } },
  { action: 'authorize', en: 'RM authorization', sw: 'Idhini ya RM', who: { en: 'Regional Manager', sw: 'Meneja wa kanda' } },
];
const CSO_TECHNICAL_STEP = { action: 'verify', en: 'CSO Technical approval', sw: 'Idhini ya kitaalamu ya CSO', who: { en: 'CSO Technical Officer', sw: 'Afisa wa kitaalamu wa CSO' } };
const DONE_LABEL = { en: 'Approved', sw: 'Imeidhinishwa' };
const NOTE_SW: Record<string, string> = {
  Cancelled: 'Imefutwa', Rejected: 'Imekataliwa', 'Returned for correction': 'Imerudishwa kwa marekebisho', 'Historical hold': 'Zuio la kihistoria',
};

/** One line above the steps saying where the record is now, so the stepper reads at a glance. */
function StepperNow({ lang, position, total, title, state, hoursInStatus }: {
  lang: 'en' | 'sw'; position: number; total: number; title: string | null; state: 'current' | 'warn' | 'danger' | 'done' | 'none'; hoursInStatus?: number;
}) {
  const sw = lang === 'sw';
  if (state === 'none' || (!title && state !== 'done')) return null;
  const text = state === 'done'
    ? (sw ? 'Hatua zote zimekamilika' : 'All steps complete')
    : `${sw ? `Hatua ${position} kati ya ${total}` : `Step ${position} of ${total}`} · ${state === 'danger' ? (sw ? 'Imesimama: ' : 'Stopped at: ') : (sw ? 'Sasa: ' : 'Now: ')}${title}`;
  return (
    <p className={`stepper-now stepper-now-${state}`}>
      <span>{text}</span>
      {state !== 'done' && state !== 'danger' && hoursInStatus !== undefined && <span className="stepper-now-age">{sw ? 'Muda katika hatua hii' : 'In this step'}: {ageText(hoursInStatus, lang)}</span>}
    </p>
  );
}

// Index of the step currently waiting, for each status (5 = all done).
const CURRENT: Record<string, number> = {
  DRAFT: 0,
  RETURNED_TO_PROVIDER: 0,
  PENDING_CTC_VERIFICATION: 1,
  PENDING_PROVIDER_OTP_CONFIRMATION: 2,
  PENDING_TECHNICAL_REVIEW: 3,
  PENDING_RPM_AUTHORIZATION: 4,
  BUDGET_HOLD: 4,
  APPROVED: 5,
};

type StepState = 'done' | 'current' | 'upcoming' | 'warn' | 'danger' | 'muted';

function states(status: string, audit: WorkLogAudit[], steps: typeof ALL_STEPS): { current: number; state: StepState[]; note: string | null } {
  if (status === 'CANCELLED') return { current: -1, state: steps.map(() => 'muted'), note: 'Cancelled' };
  if (status === 'REJECTED') {
    const rejected = [...audit].reverse().find((a) => a.new_status === 'REJECTED');
    const oldStatus = rejected?.old_status || '';
    const oldIndex: Record<string, number> = { PENDING_CTC_VERIFICATION: 1, PENDING_PROVIDER_OTP_CONFIRMATION: 2, PENDING_TECHNICAL_REVIEW: 3, PENDING_RPM_AUTHORIZATION: 4 };
    const oldStage = oldIndex[oldStatus] ?? 3;
    const hasOtp = steps.some((step) => step.action === 'confirm_otp');
    const at = !hasOtp && oldStage > 2 ? oldStage - 1 : oldStage;
    return { current: at, state: steps.map((_, i) => (i < at ? 'done' : i === at ? 'danger' : 'muted')), note: 'Rejected' };
  }
  const allCurrent = CURRENT[status] ?? 0;
  const hasOtp = steps.some((step) => step.action === 'confirm_otp');
  const current = !hasOtp && allCurrent > 2 ? allCurrent - 1 : status === 'PENDING_PROVIDER_OTP_CONFIRMATION' && !hasOtp ? 2 : allCurrent;
  const state = steps.map((_, i): StepState => {
    if (i < current) return 'done';
    if (i > current) return 'upcoming';
    if (status === 'RETURNED_TO_PROVIDER' || status === 'BUDGET_HOLD') return 'warn';
    return status === 'DRAFT' ? 'upcoming' : 'current';
  });
  const note = status === 'RETURNED_TO_PROVIDER' ? 'Returned for correction' : status === 'BUDGET_HOLD' ? 'Historical hold' : null;
  return { current, state, note };
}

/** The decision that completed each step in the latest submission cycle. */
function completedBy(audit: WorkLogAudit[]): Record<string, WorkLogAudit> {
  const lastSubmit = audit.map((a) => a.action).lastIndexOf('submit');
  const cycle = lastSubmit >= 0 ? audit.slice(lastSubmit) : audit;
  const result: Record<string, WorkLogAudit> = {};
  for (const row of cycle) if (ALL_STEPS.some((s) => s.action === row.action)) result[row.action] = row;
  return result;
}

function latestCycleHasOtp(audit: WorkLogAudit[]): boolean {
  const lastSubmit = audit.map((row) => row.action).lastIndexOf('submit');
  return audit.slice(lastSubmit >= 0 ? lastSubmit : 0).some((row) => row.action === 'confirm_otp');
}

export function ApprovalStepper({
  status,
  audit,
  hoursInStatus,
  facilityEndorsed,
  technicalReviewer,
  communityOnly = false,
  workflowVersion = 1,
  workType = 'LEGACY',
  financeTimesheetApproved = false,
}: {
  status: string;
  audit: WorkLogAudit[];
  hoursInStatus?: number;
  facilityEndorsed?: string | null;
  workflowVersion?: number;
  workType?: 'LEGACY' | 'SERVICES' | 'PAYROLL';
  /** The cadre's technical reviewer position, shown in place of the generic "Technical Officer" */
  technicalReviewer?: string | null;
  /** No facility, so CSO Technical takes the first step instead of the CTC In-Charge */
  communityOnly?: boolean;
  financeTimesheetApproved?: boolean;
}) {
  const { lang, me } = useAuth();
  const l = lang === 'sw' ? 'sw' : 'en';
  const otpSkipped = me?.client_settings.provider_otp_required === false;
  if (workflowVersion === 2 && workType !== 'PAYROLL') {
    const routeAction = status === 'ROUTED_CSO' ? 'route_cso' : 'route_fhi360';
    const allV2Steps = [
      { action: 'submit', title: 'Submitted', sw: 'Imewasilishwa' },
      { action: 'verify', title: communityOnly ? 'CSO Technical approval' : 'CTC verification', sw: communityOnly ? 'Idhini ya kitaalamu ya CSO' : 'Uhakiki wa CTC' },
      { action: 'confirm_otp', title: 'Provider confirmation', sw: 'Uthibitisho wa mtoa huduma' },
      { action: 'endorse', title: 'Technical review', sw: 'Mapitio ya kitaalamu' },
      { action: 'authorize', title: 'RM authorization', sw: 'Idhini ya RM' },
      { action: 'finance_timesheet_approve', title: 'Regional finance: timesheet', sw: 'Fedha ya Mkoa: jedwali' },
      { action: 'finance_review', title: 'Regional finance: Services payment', sw: 'Fedha ya Mkoa: malipo ya Huduma' },
      { action: routeAction, title: status === 'ROUTED_CSO' ? 'Routed to CSO' : 'Routed to FHI360', sw: status === 'ROUTED_CSO' ? 'Imetumwa CSO' : 'Imetumwa FHI360' },
      { action: 'paid', title: 'Paid', sw: 'Imelipwa' },
    ];
    const stepTitle = (step: (typeof allV2Steps)[number]) => (step.action === 'endorse' && technicalReviewer ? technicalReviewer : l === 'sw' ? step.sw : step.title);
    const showOtpV2 = !otpSkipped || latestCycleHasOtp(audit);
    // Records past finance review before this approval existed have no timesheet step to show.
    const noTimesheetStep = !financeTimesheetApproved && ['FINANCE_REVIEWED', 'ROUTED_FHI360', 'ROUTED_CSO', 'PAID', 'APPROVED'].includes(status);
    const v2Steps = allV2Steps.filter((step) => (showOtpV2 || step.action !== 'confirm_otp') && !(noTimesheetStep && step.action === 'finance_timesheet_approve'));
    const v2Position: Record<string, number> = {
      DRAFT: 0, RETURNED_TO_PROVIDER: 0, PENDING_CTC_VERIFICATION: 1, PENDING_PROVIDER_OTP_CONFIRMATION: 2,
      PENDING_TECHNICAL_REVIEW: 3, PENDING_RPM_AUTHORIZATION: 4, PENDING_FINANCE_REVIEW: financeTimesheetApproved ? 6 : 5,
      FINANCE_REVIEWED: 7, ROUTED_FHI360: 8, ROUTED_CSO: 8, PAID: 9, APPROVED: 9,
    };
    const basePosition = v2Position[status] ?? 0;
    const currentStep = basePosition - (!showOtpV2 && basePosition > 2 ? 1 : 0) - (noTimesheetStep ? 1 : 0);
    const doneRows: Record<string, WorkLogAudit> = {};
    audit.forEach((row) => { doneRows[row.action] = row; });
    const rejected = status === 'REJECTED';
    const nowIndex = rejected ? Math.min(currentStep, 5) : currentStep;
    const nowState = status === 'PAID' || status === 'APPROVED' ? 'done' : status === 'CANCELLED' || status === 'DRAFT' ? 'none' : rejected ? 'danger' : status === 'RETURNED_TO_PROVIDER' ? 'warn' : 'current';
    const nowStep = v2Steps[nowIndex];
    const nowTitle = status === 'RETURNED_TO_PROVIDER' ? (l === 'sw' ? 'Imerudishwa kwa mtoa huduma kwa marekebisho' : 'Returned to the provider for correction')
      : !nowStep ? null
      : nowStep.action === 'paid' ? (l === 'sw' ? 'Inasubiri malipo' : 'Awaiting payment')
        : nowStep.action === routeAction && !['ROUTED_FHI360', 'ROUTED_CSO'].includes(status) ? (l === 'sw' ? 'Kutumwa kwa mlipaji' : 'Routing to the payor')
          : stepTitle(nowStep);
    return (
      <div className="stepper-wrap">
        <StepperNow lang={l} position={nowIndex + 1} total={v2Steps.length} title={nowTitle} state={nowState} hoursInStatus={hoursInStatus} />
        <ol className="stepper" aria-label={l === 'sw' ? 'Hatua za idhini' : 'Approval steps'}>
          {v2Steps.map((step, index) => {
            const isPaid = step.action === 'paid';
            const routeIndex = v2Steps.findIndex((item) => item.action === routeAction);
            const done = isPaid ? status === 'PAID' : index < currentStep || (index === routeIndex && (status === 'ROUTED_FHI360' || status === 'ROUTED_CSO' || status === 'PAID'));
            const currentState = rejected && index === Math.min(currentStep, 5) ? 'danger' : done ? 'done' : index === currentStep && !isPaid ? 'current' : 'upcoming';
            const auditRow = doneRows[step.action];
            const title = stepTitle(step);
            return <li key={`${step.action}-${index}`} className={`step step-${currentState}`} aria-current={currentState === 'current' ? 'step' : undefined}>
              <span className="step-marker" aria-hidden="true">{currentState === 'done' ? <Icon name="check" size={15} /> : currentState === 'danger' ? <Icon name="close" size={14} /> : index + 1}</span>
              <div className="step-text"><span className="step-title">{title}</span><span className="step-sub">
                {auditRow ? `${auditRow.actor_name || (l === 'sw' ? 'Imerekodiwa' : 'Recorded')} · ${dateTime(auditRow.timestamp)}`
                  : currentState === 'done' ? (l === 'sw' ? 'Imekamilika' : 'Completed')
                    : currentState === 'current' ? `${l === 'sw' ? 'Inasubiri' : 'Waiting'}${hoursInStatus !== undefined ? ` · ${ageText(hoursInStatus, l)}` : ''}`
                      : isPaid ? (l === 'sw' ? 'Bado haijalipwa' : 'Not yet paid') : l === 'sw' ? 'Bado' : 'Pending'}
              </span></div>
            </li>;
          })}
        </ol>
      </div>
    );
  }
  const showOtp = !otpSkipped || latestCycleHasOtp(audit);
  const steps = (showOtp ? ALL_STEPS : ALL_STEPS.filter((step) => step.action !== 'confirm_otp'))
    .map((step) => (communityOnly && step.action === 'verify' ? CSO_TECHNICAL_STEP : step));
  const { current, state, note } = states(status, audit, steps);
  const by = completedBy(audit);
  const approved = status === 'APPROVED';
  const shownNote = note && l === 'sw' ? NOTE_SW[note] || note : note;
  const nowState = approved ? 'done' : current < 0 || status === 'DRAFT' ? 'none' : (state[current] === 'danger' ? 'danger' : state[current] === 'warn' ? 'warn' : 'current');
  const nowStep = steps[current];
  const nowTitle = nowStep ? `${nowStep.action === 'endorse' && technicalReviewer ? technicalReviewer : nowStep[l]}${nowState === 'warn' && shownNote ? ` (${shownNote})` : ''}` : null;

  return (
    <div className="stepper-wrap">
      <StepperNow lang={l} position={current + 1} total={steps.length + 1} title={nowTitle} state={nowState} hoursInStatus={status === 'DRAFT' ? undefined : hoursInStatus} />
      <ol className="stepper" aria-label={l === 'sw' ? 'Hatua za idhini' : 'Approval steps'}>
        {steps.map((step, i) => {
          const s = state[i];
          const row = s === 'done' ? by[step.action] : undefined;
          const who = step.action === 'endorse' && technicalReviewer ? technicalReviewer : step.who[l];
          return (
            <li key={step.action} className={`step step-${s}`} aria-current={s === 'current' || s === 'warn' ? 'step' : undefined}>
              <span className="step-marker" aria-hidden="true">
                {s === 'done' ? <Icon name="check" size={15} /> : s === 'danger' ? <Icon name="close" size={14} /> : s === 'warn' ? <Icon name="alert" size={14} /> : i + 1}
              </span>
              <div className="step-text">
                <span className="step-title">{step[l]}</span>
                <span className="step-sub">
                  {row ? (
                    <>
                      {row.actor_name || who} · {dateTime(row.timestamp)}
                    </>
                  ) : s === 'current' || s === 'warn' ? (
                    <>
                      {shownNote || (l === 'sw' ? 'Inasubiri' : 'Waiting')}
                      {step.action === 'endorse' && technicalReviewer && ` · ${technicalReviewer}`}
                      {hoursInStatus !== undefined && status !== 'DRAFT' && (
                        <span className={hoursInStatus > 48 ? 'step-late' : undefined}> · {ageText(hoursInStatus, l)}</span>
                      )}
                    </>
                  ) : s === 'danger' ? (
                    shownNote
                  ) : (
                    who
                  )}
                </span>
                {step.action === 'endorse' && facilityEndorsed && <span className="step-sub">{l === 'sw' ? 'Mkuu wa Kituo' : 'Facility In-Charge'}: {facilityEndorsed}</span>}
              </div>
            </li>
          );
        })}
        <li className={`step step-final ${approved ? 'step-done' : status === 'CANCELLED' || status === 'REJECTED' ? 'step-muted' : 'step-upcoming'}`}>
          <span className="step-marker" aria-hidden="true">
            <Icon name="shield" size={15} />
          </span>
          <div className="step-text">
            <span className="step-title">{DONE_LABEL[l]}</span>
            <span className="step-sub">{approved && by.authorize ? dateTime(by.authorize.timestamp) : workType === 'PAYROLL' ? (l === 'sw' ? 'Ripoti ya kazi ya mwezi' : 'Monthly work report') : l === 'sw' ? 'Si malipo bado' : 'Not yet a payment'}</span>
          </div>
        </li>
      </ol>
      {current === -1 && <p className="muted small">{l === 'sw' ? 'Jedwali hili limefutwa.' : 'This work log was cancelled.'}</p>}
    </div>
  );
}

/** Five dots for list rows: done, current (or warning) and upcoming steps. */
export function MiniStepper({ status }: { status: string }) {
  const { me } = useAuth();
  const otpSkipped = me?.client_settings.provider_otp_required === false;
  const showOtp = !otpSkipped;
  const steps = showOtp ? ALL_STEPS : ALL_STEPS.filter((step) => step.action !== 'confirm_otp');
  const { state } = states(status, [], steps);
  const done = status === 'APPROVED';
  return (
    <span className="mini-stepper" aria-hidden="true">
      {state.map((s, i) => (
        <span key={i} className={`mini-dot mini-${s}`} />
      ))}
      <span className={`mini-dot mini-${done ? 'done' : 'upcoming'}`} />
    </span>
  );
}
