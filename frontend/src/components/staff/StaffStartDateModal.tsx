import React, { useState } from 'react';
import { api } from '../../api';
import { useAction } from '../../hooks';
import { StaffDetail } from '../../types';
import { Alert, Field, Modal } from '../ui';

export function StaffStartDateModal({ staff, onClose, onSaved }: {
  staff: StaffDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startDate, setStartDate] = useState(staff.employment_start_date || '');
  const [updatePlacement, setUpdatePlacement] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const initial = [...staff.assignments].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id - b.id)[0];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(() => api.patch(`/staff/${staff.id}/start-date`, {
      start_date: startDate,
      update_initial_assignment: updatePlacement,
      reason: reason.trim(),
    }));
    if (result) onSaved();
  };

  return (
    <Modal title="Edit staff start date" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p>Correct the employment start date for <strong>{staff.legal_name}</strong>. A reason is required for the administrator audit record.</p>
        <Field label="Employment start date">
          <input type="date" required value={startDate} max={staff.employment_end_date || undefined}
            onChange={event => setStartDate(event.target.value)} />
        </Field>
        {initial && (
          <Field label="Initial placement">
            <p className="muted small">
              {initial.facility || initial.community_area || initial.region} · currently starts {initial.start_date}.
              Later placements are not changed.
            </p>
            <label>
              <input type="checkbox" checked={updatePlacement} onChange={event => setUpdatePlacement(event.target.checked)} />
              {' '}Also correct the initial placement start to the date above
            </label>
          </Field>
        )}
        <p className="muted small">
          An earlier employment date alone does not extend placement coverage. Changing placement dates can affect work-log eligibility.
          Existing workdays cannot be excluded, and submitted placement dates remain protected.
          This does not create work records or reopen closed pay periods.
        </p>
        <Field label="Reason for correction">
          <textarea required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
        </Field>
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !startDate || reason.trim().length < 3}>
            {busy ? 'Saving…' : 'Save start date'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
