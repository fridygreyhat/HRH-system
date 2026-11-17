import React, { useState } from 'react';
import { api } from '../../api';
import { useAction } from '../../hooks';
import { humanize, todayLocal } from '../../format';
import { Cadre, StaffDetail, StaffSummary } from '../../types';
import { Alert, Field, Modal, ReasonDialog } from '../ui';
import { AssignmentFields, AssignmentValue, EMPTY_ASSIGNMENT, assignmentPayload, assignmentValueFrom } from './AssignmentFields';

export { TZ_MOBILE_INPUT_PATTERN as PHONE_PATTERN } from '../../phones';
import { normalizeTzMobile, TZ_MOBILE_HINT, TZ_MOBILE_INPUT_PATTERN, TZ_MOBILE_MESSAGE } from '../../phones';
import { normalizeTin, TIN_HINT, TIN_INPUT_PATTERN, TIN_LABEL, TIN_MESSAGE } from '../../tin';
import { EMPTY_PROVIDER_PAY, NO_PROVIDER_PAY, ProviderPay, ProviderPayFields, providerPayPayload, SERVICES_ONLY_NOTE } from './ProviderPayFields';
import { FACILITY_STAFF_TYPE_MESSAGE, FACILITY_STAFF_TYPES, FacilityStaffTypeField, isHcp } from './FacilityStaffType';
export const PAYMENT_METHODS = ['MOBILE_WALLET', 'BANK'];
export const ENROLLMENT_SOURCES = ['MANUAL', 'ROSTER_IMPORT', 'ENGAGEMENT_LIST'];
export const PAYMENT_CRITICAL = ['cadre_id', 'salary_scale', 'payment_method', 'payment_provider', 'payment_account', 'verified_phone', 'status',
  'first_name', 'middle_name', 'last_name', 'tin_number'];

const isOther = (s: string) => s.trim().toLowerCase() === 'other';
const blankToNull = (s: string): string | null => (s.trim() ? s.trim() : null);

export function OccupationFields({
  cadre,
  occupation,
  other,
  onOccupation,
  onOther,
  required = false,
}: {
  cadre: Cadre | undefined;
  occupation: string;
  other: string;
  onOccupation: (v: string) => void;
  onOther: (v: string) => void;
  /** Registration asks for the position; older records may still have none. */
  required?: boolean;
}) {
  const options = cadre?.occupation_options || [];
  const label = `Position${required ? ' *' : ''}`;
  return (
    <>
      {options.length ? (
        <Field label={label} hint="From the HRH cadre list">
          <select value={occupation} onChange={(e) => onOccupation(e.target.value)} required={required}>
            <option value="">—</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {occupation && !options.includes(occupation) && <option value={occupation}>{occupation}</option>}
          </select>
        </Field>
      ) : (
        <Field label={label}>
          <input value={occupation} onChange={(e) => onOccupation(e.target.value)} maxLength={100} required={required} />
        </Field>
      )}
      {isOther(occupation) && (
        <Field label="Other position (specify)">
          <input value={other} onChange={(e) => onOther(e.target.value)} required maxLength={100} />
        </Field>
      )}
    </>
  );
}

function PaymentMethodSelect({ value, onChange, label = 'Payment method' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>
            {humanize(m)}
          </option>
        ))}
        {value && !PAYMENT_METHODS.includes(value) && <option value={value}>{humanize(value)}</option>}
      </select>
    </Field>
  );
}

function FormButtons({ busy, label, busyLabel, onCancel, disabled }: { busy: boolean; label: string; busyLabel: string; onCancel: () => void; disabled?: boolean }) {
  return (
    <div className="row">
      <button className="btn btn-primary" disabled={busy || disabled}>
        {busy ? busyLabel : label}
      </button>
      <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}

const REGISTER_STEPS = ['Person', 'Placement', 'Pay'];

export function CreateStaffModal({ cadres, onClose, onCreated }: { cadres: Cadre[]; onClose: () => void; onCreated: (s: StaffSummary) => void }) {
  const [f, setF] = useState({
    cadre_id: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    verified_phone: '',
    occupation: '',
    occupation_other: '',
    facility_staff_type: '',
    salary_scale: '',
    employment_start_date: todayLocal(),
    enrollment_source: 'MANUAL',
  });
  const [pay, setPay] = useState<ProviderPay>(EMPTY_PROVIDER_PAY);
  const [assignment, setAssignment] = useState<AssignmentValue>(EMPTY_ASSIGNMENT);
  const [step, setStep] = useState(0);
  const { busy, error, setError, run } = useAction();
  const cadre = cadres.find((c) => String(c.id) === f.cadre_id);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  // Government facility staff HCPs are paid for Services only: no salary, so no TIN, bank account or salary scale.
  const servicesOnly = isHcp(cadre?.code) && f.facility_staff_type === 'GOVERNMENT';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payment = servicesOnly ? NO_PROVIDER_PAY : providerPayPayload(pay);
    if (typeof payment === 'string') {
      setError(payment);
      return;
    }
    const created = await run(() =>
      api.post<StaffSummary>('/staff', {
        cadre_id: Number(f.cadre_id),
        first_name: f.first_name.trim(),
        middle_name: blankToNull(f.middle_name),
        last_name: f.last_name.trim(),
        verified_phone: f.verified_phone.trim(),
        ...payment,
        occupation: blankToNull(f.occupation),
        occupation_other: isOther(f.occupation) ? blankToNull(f.occupation_other) : null,
        facility_staff_type: isHcp(cadre?.code) ? f.facility_staff_type : null,
        salary_scale: servicesOnly || cadre?.code === 'CHW' ? null : blankToNull(f.salary_scale),
        employment_start_date: f.employment_start_date,
        enrollment_source: f.enrollment_source,
        assignment: assignmentPayload(assignment),
      }),
    );
    if (created) onCreated(created);
  };

  const canPay = step === REGISTER_STEPS.length - 1;
  const next = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 0 && isHcp(cadre?.code) && !f.facility_staff_type) {
      setError(FACILITY_STAFF_TYPE_MESSAGE);
      return;
    }
    setError('');
    setStep(step + 1);
  };

  return (
    <Modal title="Register staff member" onClose={onClose}>
      <form className="stack" onSubmit={canPay ? submit : next}>
        <ol className="wizard-steps" aria-label="Registration steps">
          {REGISTER_STEPS.map((name, index) => (
            <li key={name} className={index === step ? 'is-current' : index < step ? 'is-done' : undefined} aria-current={index === step ? 'step' : undefined}>
              <span>{index < step ? '✓' : index + 1}</span>{name}
            </li>
          ))}
        </ol>
        {step === 0 && <>
          <p className="muted small">If this phone already exists, rotate the assignment instead.</p>
          <div className="grid-2">
            <Field label="Cadre (required)">
              <select value={f.cadre_id} onChange={(e) => setF({ ...f, cadre_id: e.target.value, occupation: '', occupation_other: '', facility_staff_type: '' })} required>
                <option value="">Select…</option>
                {cadres.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <OccupationFields
              cadre={cadre}
              occupation={f.occupation}
              other={f.occupation_other}
              onOccupation={(v) => setF({ ...f, occupation: v })}
              onOther={(v) => setF({ ...f, occupation_other: v })}
              required
            />
            {isHcp(cadre?.code) && (
              <div className="grid-full">
                <FacilityStaffTypeField value={f.facility_staff_type} onChange={(v) => setF({ ...f, facility_staff_type: v })} />
              </div>
            )}
            <Field label="First name (required)">
              <input value={f.first_name} onChange={set('first_name')} required maxLength={100} autoComplete="off" />
            </Field>
            <Field label="Middle name">
              <input value={f.middle_name} onChange={set('middle_name')} maxLength={100} autoComplete="off" />
            </Field>
            <Field label="Last name (required)">
              <input value={f.last_name} onChange={set('last_name')} required maxLength={100} autoComplete="off" />
            </Field>
            <Field label="Mobile phone (required)" hint={TZ_MOBILE_HINT}>
              <input type="tel" value={f.verified_phone} onChange={set('verified_phone')} required pattern={TZ_MOBILE_INPUT_PATTERN} autoComplete="off" />
            </Field>
            <Field label="Employment start date (required)">
              <input type="date" value={f.employment_start_date} onChange={set('employment_start_date')} required />
            </Field>
            <Field label="Enrollment source">
              <select value={f.enrollment_source} onChange={set('enrollment_source')}>
                {ENROLLMENT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>}
        {step === 1 && <>
          <p className="muted small">Set the CSO so this person appears in salary files.</p>
          <AssignmentFields value={assignment} onChange={setAssignment} showSection={cadre ? cadre.uses_section : true} />
        </>}
        {step === 2 && <>
          <div className="wizard-summary">
            <strong>{[f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' ')}</strong>
            <span>
              {[cadre?.name, f.occupation, FACILITY_STAFF_TYPES.find((t) => t.value === f.facility_staff_type)?.label, f.verified_phone].filter(Boolean).join(' · ')}
            </span>
          </div>
          {servicesOnly ? (
            <div className="notice notice-info">{SERVICES_ONLY_NOTE}</div>
          ) : (
            <>
              {!assignment.organization_id && <Alert kind="warn">No CSO set; this person will not appear in any salary file.</Alert>}
              {cadre?.code === 'CHW' ? (
                <p className="muted small">CHWs are paid the CHW Payroll package (stipend, transport and communication), set by Central Finance.</p>
              ) : (
                <div className="grid-2">
                  <Field label="Salary scale" hint="Type it exactly as on Salary amounts">
                    <input value={f.salary_scale} onChange={set('salary_scale')} maxLength={50} />
                  </Field>
                </div>
              )}
              <ProviderPayFields value={pay} onChange={setPay} disabled={busy} />
              <p className="muted small">Services are paid to the mobile wallet of the phone above.</p>
            </>
          )}
        </>}
        <Alert>{error}</Alert>
        <div className="row">
          {step > 0 && <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}
          <button className="btn btn-primary" disabled={busy}>{canPay ? (busy ? 'Saving…' : 'Register') : 'Next'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

type EditKey =
  | 'first_name'
  | 'middle_name'
  | 'last_name'
  | 'occupation'
  | 'occupation_other'
  | 'facility_staff_type'
  | 'tin_number'
  | 'cadre_id'
  | 'salary_scale'
  | 'payment_method'
  | 'payment_provider'
  | 'payment_account'
  | 'verified_phone'
  | 'status';

interface EditResult {
  applied: boolean;
  change_request_id?: number | null;
}

export function EditStaffModal({
  staff,
  cadres,
  csoRequest,
  onClose,
  onSaved,
  onPlacement,
}: {
  staff: StaffDetail;
  cadres: Cadre[];
  /** CSO finance: payment-critical changes become a change request. */
  csoRequest: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onPlacement?: () => void;
}) {
  const showPayment = 'payment_method' in staff;
  const initial: Record<EditKey, string> = {
    first_name: staff.first_name,
    middle_name: staff.middle_name || '',
    last_name: staff.last_name,
    occupation: staff.occupation || '',
    occupation_other: staff.occupation_other || '',
    facility_staff_type: staff.facility_staff_type || '',
    tin_number: staff.tin_number || '',
    cadre_id: String(staff.cadre_id),
    salary_scale: staff.salary_scale || '',
    payment_method: staff.payment_method || '',
    payment_provider: staff.payment_provider || '',
    payment_account: staff.payment_account || '',
    verified_phone: staff.verified_phone,
    status: staff.status,
  };
  const [f, setF] = useState(initial);
  const [reason, setReason] = useState('');
  const { busy, error, setError, run } = useAction();
  const cadre = cadres.find((c) => String(c.id) === f.cadre_id);
  const set = (k: EditKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const changed = (Object.keys(f) as EditKey[]).filter((k) => f[k].trim() !== initial[k].trim());
  const criticalChanged = changed.filter((k) => PAYMENT_CRITICAL.includes(k));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed.length) {
      setError('Nothing has changed.');
      return;
    }
    if (changed.includes('verified_phone') && !normalizeTzMobile(f.verified_phone)) {
      setError(TZ_MOBILE_MESSAGE);
      return;
    }
    if (changed.includes('tin_number') && normalizeTin(f.tin_number) === null) {
      setError(TIN_MESSAGE);
      return;
    }
    const changes: Record<string, string | number | null> = {};
    changed.forEach((k) => {
      if (k === 'cadre_id') changes[k] = Number(f.cadre_id);
      else if (k === 'tin_number') changes[k] = normalizeTin(f.tin_number) || null;
      else if (k === 'first_name' || k === 'last_name' || k === 'verified_phone' || k === 'status') changes[k] = f[k].trim();
      else changes[k] = blankToNull(f[k]);
    });
    const result = await run(() => api.patch<EditResult>(`/staff/${staff.id}`, { changes, reason: reason.trim() }));
    if (!result) return;
    const parts: string[] = [];
    if (result.applied) parts.push('Changes saved.');
    if (result.change_request_id) parts.push(`Change request #${result.change_request_id} submitted for approval by another HRH administrator.`);
    onSaved(parts.join(' ') || 'Saved.');
  };

  const lockedNote = ' (needs approval)';

  return (
    <Modal title={`Edit ${staff.legal_name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {onPlacement && <div className="notice notice-info">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onPlacement}>Change facility / placement</button>
        </div>}
        <div className="notice notice-info">
          Fields marked “needs approval” go to another HRH administrator before applying.
        </div>
        <div className="grid-2">
          <Field label={`First name${lockedNote}`}>
            <input value={f.first_name} onChange={set('first_name')} required maxLength={100} />
          </Field>
          <Field label={`Middle name${lockedNote}`}>
            <input value={f.middle_name} onChange={set('middle_name')} maxLength={100} />
          </Field>
          <Field label={`Last name${lockedNote}`}>
            <input value={f.last_name} onChange={set('last_name')} required maxLength={100} />
          </Field>
          <OccupationFields
            cadre={cadre}
            occupation={f.occupation}
            other={f.occupation_other}
            onOccupation={(v) => setF({ ...f, occupation: v })}
            onOther={(v) => setF({ ...f, occupation_other: v })}
          />
          {isHcp(staff.cadre) && (
            <div className="grid-full">
              <FacilityStaffTypeField name="edit_facility_staff_type" value={f.facility_staff_type} onChange={(v) => setF({ ...f, facility_staff_type: v })} required={false} />
            </div>
          )}
          <Field label={`TIN${lockedNote}`} hint="9 digits, e.g. 123-456-789.">
            <input inputMode="numeric" value={f.tin_number} onChange={set('tin_number')} pattern={TIN_INPUT_PATTERN} maxLength={13} placeholder="123-456-789" />
          </Field>
          <Field label={`Cadre${lockedNote}`}>
            <select value={f.cadre_id} onChange={set('cadre_id')}>
              {cadres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Salary scale${lockedNote}`}>
            <input value={f.salary_scale} onChange={set('salary_scale')} maxLength={50} />
          </Field>
          <Field label={`Verified phone${lockedNote}`} hint="9–15 digits, optional leading +">
            <input type="tel" value={f.verified_phone} onChange={set('verified_phone')} required pattern={TZ_MOBILE_INPUT_PATTERN} />
          </Field>
          <Field label="Status" hint={csoRequest ? undefined : 'Use “Exit” to end employment.'}>
            <select value={f.status} onChange={set('status')}>
              <option value="ACTIVE">Active</option>
              <option value="EXITED">Exited</option>
            </select>
          </Field>
          {showPayment && (
            <>
              <PaymentMethodSelect value={f.payment_method} onChange={(v) => setF({ ...f, payment_method: v })} label={`Payment method${lockedNote}`} />
              <Field label={`Payment provider${lockedNote}`}>
                <input value={f.payment_provider} onChange={set('payment_provider')} maxLength={100} />
              </Field>
              <Field label={`Payment account${lockedNote}`}>
                <input value={f.payment_account} onChange={set('payment_account')} maxLength={100} autoComplete="off" />
              </Field>
            </>
          )}
        </div>
        <Field label="Reason for the change (required)">
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={1000} />
        </Field>
        {changed.length > 0 && (
          <p className="small muted">
            Changing: {changed.map((k) => humanize(k)).join(', ')}
            {criticalChanged.length > 0 && ` — ${criticalChanged.map((k) => humanize(k)).join(', ')} will go to another HRH administrator for approval`}.
          </p>
        )}
        <Alert>{error}</Alert>
        <FormButtons
          busy={busy}
          label={criticalChanged.length ? 'Save / request approval' : 'Save changes'}
          busyLabel="Saving…"
          onCancel={onClose}
          disabled={!changed.length || reason.trim().length < 3}
        />
      </form>
    </Modal>
  );
}

export function RotateModal({ staff, cadres, onClose, onDone }: { staff: StaffDetail; cadres: Cadre[]; onClose: () => void; onDone: (s: StaffDetail) => void }) {
  const [effective, setEffective] = useState(todayLocal());
  const [reason, setReason] = useState('');
  // Start from the current placement so a rotation only changes what actually moves.
  const [assignment, setAssignment] = useState<AssignmentValue>(() => assignmentValueFrom(staff.assignments.find((a) => !a.end_date) || staff.assignments[0]));
  const { busy, error, run } = useAction();
  const cadre = cadres.find((c) => c.id === staff.cadre_id);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await run(() =>
      api.post<StaffDetail>(`/staff/${staff.id}/rotate`, { effective_date: effective, reason: reason.trim(), assignment: assignmentPayload(assignment) }),
    );
    if (updated) onDone(updated);
  };
  return (
    <Modal title={`Change facility / placement · ${staff.legal_name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">The current placement ends the day before the effective date.</p>
        <div className="grid-2">
          <Field label="Effective date (required)">
            <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} required />
          </Field>
        </div>
        <AssignmentFields value={assignment} onChange={setAssignment} showSection={cadre ? cadre.uses_section : true} />
        <Field label="Reason (required)">
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={1000} />
        </Field>
        <Alert>{error}</Alert>
        <FormButtons busy={busy} label="Rotate" busyLabel="Saving…" onCancel={onClose} disabled={reason.trim().length < 3 || !assignment.region_id} />
      </form>
    </Modal>
  );
}

export function ExitDialog({ staff, onClose, onDone }: { staff: StaffDetail; onClose: () => void; onDone: (s: StaffDetail) => void }) {
  const [endDate, setEndDate] = useState(todayLocal());
  return (
    <ReasonDialog
      title={`Exit ${staff.legal_name}`}
      description="All open assignments end on the end date. This cannot be undone here."
      required
      danger
      confirmLabel="Exit staff member"
      onClose={onClose}
      onConfirm={async (reason) => {
        if (reason.length < 3) throw new Error('Reason must be at least 3 characters.');
        if (!endDate) throw new Error('Choose an end date.');
        onDone(await api.post<StaffDetail>(`/staff/${staff.id}/exit`, { end_date: endDate, reason }));
      }}
    >
      <Field label="End date (required)">
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
      </Field>
    </ReasonDialog>
  );
}

export function LoginModal({ staff, onClose, onDone }: { staff: StaffDetail; onClose: () => void; onDone: (username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await run(() => api.post<{ user_id: number; username: string }>(`/staff/${staff.id}/login`, { username: username.trim(), temporary_password: password }));
    if (res) onDone(res.username);
  };
  return (
    <Modal title={`Create login for ${staff.legal_name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">Share the temporary password privately.</p>
        <Field label="Username (at least 3 characters)">
          <input value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={100} autoComplete="off" />
        </Field>
        <Field label="Temporary password (at least 8 characters)">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={72} autoComplete="new-password" />
        </Field>
        <Alert>{error}</Alert>
        <FormButtons busy={busy} label="Create login" busyLabel="Creating…" onCancel={onClose} disabled={username.trim().length < 3 || password.length < 8} />
      </form>
    </Modal>
  );
}
