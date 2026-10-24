import React from 'react';
import { useAuth } from '../../AuthContext';
import { dateTime, hoursAge } from '../../format';
import { WorkLogAudit } from '../../types';
import { Icon } from '../Icon';

/**
 * Visual map of the approval journey every cadre follows:
 * Submitted → CTC verification → Provider confirmation (SMS code) → Technical review → RPM authorization → Approved.
 * Who acted and when comes from the audit trail of the current submission cycle.
 */
const STEPS = [
  { action: 'submit', en: 'Submitted', sw: 'Imewasilishwa', who: { en: 'Provider', sw: 'Mtoa huduma' } },
  { action: 'verify', en: 'CTC verification', sw: 'Uhakiki wa CTC', who: { en: 'CTC In-Charge', sw: 'Mkuu wa CTC' } },
  { action: 'confirm_otp', en: 'Provider confirmation', sw: 'Uthibitisho wa mtoa huduma', who: { en: 'SMS code', sw: 'Namba ya SMS' } },
  { action: 'endorse', en: 'Technical review', sw: 'Mapitio ya kitaalamu', who: { en: 'Technical Officer', sw: 'Afisa wa kitaalamu' } },
  { action: 'authorize', en: 'RPM authorization', sw: 'Idhini ya RPM', who: { en: 'Regional Manager', sw: 'Meneja wa kanda' } },
];
const DONE_LABEL = { en: 'Approved', sw: 'Imeidhinishwa' };

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
const STAGE_OF_STATUS: Record<string, number> = { PENDING_CTC_VERIFICATION: 1, PENDING_PROVIDER_OTP_CONFIRMATION: 2, PENDING_TECHNICAL_REVIEW: 3, PENDING_RPM_AUTHORIZATION: 4 };

type StepState = 'done' | 'current' | 'upcoming' | 'warn' | 'danger' | 'muted';

const OTP_STEP = 2;

function states(status: string, audit: WorkLogAudit[], otpSkipped = false): { current: number; state: StepState[]; note: string | null } {
  const result = baseStates(status, audit);
  // With provider confirmation switched off, a log that never waited for a code shows that step as not required.
  if (otpSkipped && status !== 'PENDING_PROVIDER_OTP_CONFIRMATION' && !audit.some((a) => a.action === 'confirm_otp')) {
    result.state = result.state.map((s, i) => (i === OTP_STEP && s !== 'danger' ? 'muted' : s));
  }
  return result;
}

function baseStates(status: string, audit: WorkLogAudit[]): { current: number; state: StepState[]; note: string | null } {
  if (status === 'CANCELLED') return { current: -1, state: STEPS.map(() => 'muted'), note: 'Cancelled' };
  if (status === 'REJECTED') {
    const rejected = [...audit].reverse().find((a) => a.new_status === 'REJECTED');
    const at = STAGE_OF_STATUS[rejected?.old_status || ''] ?? 3;
    return { current: at, state: STEPS.map((_, i) => (i < at ? 'done' : i === at ? 'danger' : 'muted')), note: 'Rejected' };
  }
  const current = CURRENT[status] ?? 0;
  const state = STEPS.map((_, i): StepState => {
    if (i < current) return 'done';
    if (i > current) return 'upcoming';
    if (status === 'RETURNED_TO_PROVIDER' || status === 'BUDGET_HOLD') return 'warn';
    return status === 'DRAFT' ? 'upcoming' : 'current';
  });
  const note = status === 'RETURNED_TO_PROVIDER' ? 'Returned for correction' : status === 'BUDGET_HOLD' ? 'Budget hold' : null;
  return { current, state, note };
}

/** The decision that completed each step in the latest submission cycle. */
function completedBy(audit: WorkLogAudit[]): Record<string, WorkLogAudit> {
  const lastSubmit = audit.map((a) => a.action).lastIndexOf('submit');
  const cycle = lastSubmit >= 0 ? audit.slice(lastSubmit) : audit;
  const result: Record<string, WorkLogAudit> = {};
  for (const row of cycle) if (STEPS.some((s) => s.action === row.action)) result[row.action] = row;
  return result;
}

export function ApprovalStepper({
  status,
  audit,
  hoursInStatus,
  facilityEndorsed,
  technicalReviewer,
  workflowVersion = 1,
  workType = 'LEGACY',
}: {
  status: string;
  audit: WorkLogAudit[];
  hoursInStatus?: number;
  facilityEndorsed?: string | null;
  workflowVersion?: number;
  workType?: 'LEGACY' | 'SERVICES' | 'PAYROLL';
  /** The cadre's technical reviewer position, shown in place of the generic "Technical Officer" */
  technicalReviewer?: string | null;
}) {
  const { lang, me } = useAuth();
  const l = lang === 'sw' ? 'sw' : 'en';
  const otpSkipped = me?.client_settings.provider_otp_required === false;
  if (workflowVersion === 2) {
    const routeAction = status === 'ROUTED_CSO' ? 'route_cso' : 'route_fhi360';
    const v2Steps = [
      { action: 'submit', title: 'Submitted' },
      { action: 'verify', title: 'CTC verification' },
      { action: 'confirm_otp', title: 'Provider confirmation' },
      { action: 'endorse', title: 'Technical review' },
      { action: 'authorize', title: 'RPM authorization' },
      { action: 'finance_review', title: 'Regional finance review' },
      { action: routeAction, title: status === 'ROUTED_CSO' ? 'Routed to CSO' : 'Routed to FHI360' },
      { action: 'paid', title: 'Paid' },
    ];
    const v2Position: Record<string, number> = {
      DRAFT: 0, RETURNED_TO_PROVIDER: 0, PENDING_CTC_VERIFICATION: 1, PENDING_PROVIDER_OTP_CONFIRMATION: 2,
      PENDING_TECHNICAL_REVIEW: 3, PENDING_RPM_AUTHORIZATION: 4, PENDING_FINANCE_REVIEW: 5,
      FINANCE_REVIEWED: 6, ROUTED_FHI360: 7, ROUTED_CSO: 7, PAID: 8, APPROVED: 8,
    };
    const currentStep = v2Position[status] ?? 0;
    const doneRows: Record<string, WorkLogAudit> = {};
    audit.forEach((row) => { doneRows[row.action] = row; });
    const rejected = status === 'REJECTED';
    return (
      <div className="stepper-wrap">
        <p className="muted small">{workType} workflow · version 2</p>
        <ol className="stepper" aria-label={l === 'sw' ? 'Hatua za idhini' : 'Approval steps'}>
          {v2Steps.map((step, index) => {
            const isPaid = step.action === 'paid';
            const done = isPaid ? status === 'PAID' : index < currentStep || (index === 6 && (status === 'ROUTED_FHI360' || status === 'ROUTED_CSO' || status === 'PAID'));
            const currentState = rejected && index === Math.min(currentStep, 5) ? 'danger' : done ? 'done' : index === currentStep && !isPaid ? 'current' : 'upcoming';
            const auditRow = doneRows[step.action];
            const title = step.action === 'endorse' && technicalReviewer ? technicalReviewer : step.title;
            return <li key={`${step.action}-${index}`} className={`step step-${currentState}`} aria-current={currentState === 'current' ? 'step' : undefined}>
              <span className="step-marker" aria-hidden="true">{currentState === 'done' ? <Icon name="check" size={15} /> : currentState === 'danger' ? <Icon name="close" size={14} /> : index + 1}</span>
              <div className="step-text"><span className="step-title">{title}</span><span className="step-sub">
                {auditRow ? `${auditRow.actor_name || 'Recorded'} · ${dateTime(auditRow.timestamp)}` : currentState === 'current' ? `Waiting${hoursInStatus !== undefined ? ` · ${hoursAge(hoursInStatus)}` : ''}` : isPaid ? 'Not yet paid' : 'Pending'}
              </span></div>
            </li>;
          })}
        </ol>
      </div>
    );
  }
  const { current, state, note } = states(status, audit, otpSkipped);
  const by = completedBy(audit);
  const approved = status === 'APPROVED';

  return (
    <div className="stepper-wrap">
      <ol className="stepper" aria-label={l === 'sw' ? 'Hatua za idhini' : 'Approval steps'}>
        {STEPS.map((step, i) => {
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
                      {note || (l === 'sw' ? 'Inasubiri' : 'Waiting')}
                      {step.action === 'endorse' && technicalReviewer && ` · ${technicalReviewer}`}
                      {hoursInStatus !== undefined && status !== 'DRAFT' && (
                        <span className={hoursInStatus > 48 ? 'step-late' : undefined}> · {hoursAge(hoursInStatus)}</span>
                      )}
                    </>
                  ) : s === 'muted' && i === OTP_STEP && otpSkipped ? (
                    l === 'sw' ? 'Haihitajiki' : 'Not required'
                  ) : s === 'danger' ? (
                    note
                  ) : (
                    who
                  )}
                </span>
                {step.action === 'endorse' && facilityEndorsed && <span className="step-sub">Facility In-Charge: {facilityEndorsed}</span>}
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
            <span className="step-sub">{approved && by.authorize ? dateTime(by.authorize.timestamp) : l === 'sw' ? 'Si malipo bado' : 'Not yet a payment'}</span>
          </div>
        </li>
      </ol>
      {current === -1 && <p className="muted small">This work log was cancelled.</p>}
    </div>
  );
}

/** Five dots for list rows: done, current (or warning) and upcoming steps. */
export function MiniStepper({ status }: { status: string }) {
  const { me } = useAuth();
  const { state } = states(status, [], me?.client_settings.provider_otp_required === false);
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
