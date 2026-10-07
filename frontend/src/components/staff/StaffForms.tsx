import React, { useState } from 'react';
import { api } from '../../api';
import { useAction } from '../../hooks';
import { humanize, todayLocal } from '../../format';
import { Cadre, StaffDetail, StaffSummary } from '../../types';
import { Alert, Field, Modal, ReasonDialog } from '../ui';
import { AssignmentFields, AssignmentValue, EMPTY_ASSIGNMENT, assignmentPayload, assignmentValueFrom } from './AssignmentFields';

export const PHONE_PATTERN = '^\\+?\\d{9,15}$';
const PHONE_RE = new RegExp(PHONE_PATTERN);
export const PAYMENT_METHODS = ['MOBILE_WALLET', 'BANK'];
export const ENROLLMENT_SOURCES = ['MANUAL', 'ROSTER_IMPORT', 'ENGAGEMENT_LIST'];
export const PAYMENT_CRITICAL = ['cadre_id', 'salary_scale', 'payment_method', 'payment_provider', 'payment_account', 'verified_phone', 'status'];

const isOther = (s: string) => s.trim().toLowerCase() === 'other';
const blankToNull = (s: string): string | null => (s.trim() ? s.trim() : null);

function OccupationFields({
  cadre,
  occupation,
  other,
  onOccupation,
  onOther,
}: {
  cadre: Cadre | undefined;
  occupation: string;
  other: string;
  onOccupation: (v: string) => void;
  onOther: (v: string) => void;
}) {
  const options = cadre?.occupation_options || [];
  return (
    <>
      {options.length ? (
        <Field label="Occupation">
          <select value={occupation} onChange={(e) => onOccupation(e.target.value)}>
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
        <Field label="Occupation">
          <input value={occupation} onChange={(e) => onOccupation(e.target.value)} maxLength={100} />
        </Field>
      )}
      {isOther(occupation) && (
        <Field label="Other occupation (specify)">
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

export function CreateStaffModal({ cadres, onClose, onCreated }: { cadres: Cadre[]; onClose: () => void; onCreated: (s: StaffSummary) => void }) {
  const [f, setF] = useState({
    cadre_id: '',
    first_name: '',
    middle_name: '',
    last_name: '',
    verified_phone: '',
    occupation: '',
    occupation_other: '',
    salary_scale: '',
    employment_start_date: todayLocal(),
    enrollment_source: 'MANUAL',
    payment_method: '',
    payment_provider: '',
    payment_account: '',
  });
  const [assignment, setAssignment] = useState<AssignmentValue>(EMPTY_ASSIGNMENT);
  const { busy, error, run } = useAction();
  const cadre = cadres.find((c) => String(c.id) === f.cadre_id);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await run(() =>
      api.post<StaffSummary>('/staff', {
        cadre_id: Number(f.cadre_id),
        first_name: f.first_name.trim(),
        middle_name: blankToNull(f.middle_name),
        last_name: f.last_name.trim(),
        verified_phone: f.verified_phone.trim(),
        occupation: blankToNull(f.occupation),
        occupation_other: isOther(f.occupation) ? blankToNull(f.occupation_other) : null,
        salary_scale: blankToNull(f.salary_scale),
        employment_start_date: f.employment_start_date,
        enrollment_source: f.enrollment_source,
        payment_method: blankToNull(f.payment_method),
        payment_provider: blankToNull(f.payment_provider),
        payment_account: blankToNull(f.payment_account),
        assignment: assignmentPayload(assignment),
      }),
    );
    if (created) onCreated(created);
  };

  return (
    <Modal title="Register staff member" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">
          One identity per person: if this person already exists (same phone number), rotate their assignment instead of registering them again.
        </p>
        <h4>Identity</h4>
        <div className="grid-2">
          <Field label="Cadre (required)">
            <select value={f.cadre_id} onChange={(e) => setF({ ...f, cadre_id: e.target.value, occupation: '', occupation_other: '' })} required>
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
          />
          <Field label="First name (required)">
            <input value={f.first_name} onChange={set('first_name')} required maxLength={100} autoComplete="off" />
          </Field>
          <Field label="Middle name">
            <input value={f.middle_name} onChange={set('middle_name')} maxLength={100} autoComplete="off" />
          </Field>
          <Field label="Last name (required)">
            <input value={f.last_name} onChange={set('last_name')} required maxLength={100} autoComplete="off" />
          </Field>
          <Field label="Verified phone (required)" hint="9–15 digits, optional leading +, e.g. +255712345678">
            <input type="tel" value={f.verified_phone} onChange={set('verified_phone')} required pattern={PHONE_PATTERN} autoComplete="off" />
          </Field>
          <Field label="Salary scale">
            <input value={f.salary_scale} onChange={set('salary_scale')} maxLength={50} />
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
        <h4>Payment details</h4>
        <div className="grid-2">
          <PaymentMethodSelect value={f.payment_method} onChange={(v) => setF({ ...f, payment_method: v })} />
          <Field label="Payment provider" hint="e.g. M-Pesa, CRDB">
            <input value={f.payment_provider} onChange={set('payment_provider')} maxLength={100} />
          </Field>
          <Field label="Payment account / wallet number">
            <input value={f.payment_account} onChange={set('payment_account')} maxLength={100} autoComplete="off" />
          </Field>
        </div>
        <h4>Assignment</h4>
        <AssignmentFields value={assignment} onChange={setAssignment} showSection={cadre ? cadre.uses_section : true} />
        <Alert>{error}</Alert>
        <FormButtons busy={busy} label="Register" busyLabel="Saving…" onCancel={onClose} />
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
}: {
  staff: StaffDetail;
  cadres: Cadre[];
  /** CSO finance: payment-critical changes become a change request. */
  csoRequest: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const showPayment = 'payment_method' in staff;
  const initial: Record<EditKey, string> = {
    first_name: staff.first_name,
    middle_name: staff.middle_name || '',
    last_name: staff.last_name,
    occupation: staff.occupation || '',
    occupation_other: staff.occupation_other || '',
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
    if (changed.includes('verified_phone') && !PHONE_RE.test(f.verified_phone.trim())) {
      setError('Phone must be 9–15 digits with an optional leading +.');
      return;
    }
    const changes: Record<string, string | number | null> = {};
    changed.forEach((k) => {
      if (k === 'cadre_id') changes[k] = Number(f.cadre_id);
      else if (k === 'first_name' || k === 'last_name' || k === 'verified_phone' || k === 'status') changes[k] = f[k].trim();
      else changes[k] = blankToNull(f[k]);
    });
    const result = await run(() => api.patch<EditResult>(`/staff/${staff.id}`, { changes, reason: reason.trim() }));
    if (!result) return;
    const parts: string[] = [];
    if (result.applied) parts.push('Changes saved.');
    if (result.change_request_id) parts.push(`Change request #${result.change_request_id} submitted for HRH approval.`);
    onSaved(parts.join(' ') || 'Saved.');
  };

  const lockedNote = csoRequest ? ' (needs HRH approval)' : '';

  return (
    <Modal title={`Edit ${staff.legal_name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {csoRequest && (
          <div className="notice notice-info">
            Changes to payment-critical fields — cadre, salary scale, payment method, provider and account, verified phone and status — are not applied
            directly. They are sent to HRH administrators as a change request for approval. Name and occupation changes are saved immediately.
          </div>
        )}
        <div className="grid-2">
          <Field label="First name">
            <input value={f.first_name} onChange={set('first_name')} required maxLength={100} />
          </Field>
          <Field label="Middle name">
            <input value={f.middle_name} onChange={set('middle_name')} maxLength={100} />
          </Field>
          <Field label="Last name">
            <input value={f.last_name} onChange={set('last_name')} required maxLength={100} />
          </Field>
          <OccupationFields
            cadre={cadre}
            occupation={f.occupation}
            other={f.occupation_other}
            onOccupation={(v) => setF({ ...f, occupation: v })}
            onOther={(v) => setF({ ...f, occupation_other: v })}
          />
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
            <input type="tel" value={f.verified_phone} onChange={set('verified_phone')} required pattern={PHONE_PATTERN} />
          </Field>
          <Field label={`Status${lockedNote}`} hint={csoRequest ? undefined : 'To end employment and close assignments, use “Exit” instead.'}>
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
            {csoRequest && criticalChanged.length > 0 && ` — ${criticalChanged.map((k) => humanize(k)).join(', ')} will go to HRH for approval`}.
          </p>
        )}
        <Alert>{error}</Alert>
        <FormButtons
          busy={busy}
          label={csoRequest && criticalChanged.length ? 'Save / request approval' : 'Save changes'}
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
    <Modal title={`Rotate ${staff.legal_name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">The current assignment ends the day before the effective date and the new one starts on it. History is kept.</p>
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
      description="The staff member is marked as exited and every open assignment ends on the end date. This cannot be undone here."
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
        <p className="muted small">Creates a provider account linked to this staff member. Share the temporary password securely; they should change it at first sign-in.</p>
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
