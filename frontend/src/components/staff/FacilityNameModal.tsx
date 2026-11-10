import React, { useState } from 'react';
import { api } from '../../api';
import { useAction } from '../../hooks';
import { Alert, Field, Modal } from '../ui';

export function FacilityNameModal({ facilityId, initialName, onClose, onSaved }: {
  facilityId: number;
  initialName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(() => api.patch(`/admin/facilities/${facilityId}/name`, { name: name.trim(), reason: reason.trim() }));
    if (result) onSaved();
  };
  return (
    <Modal title="Edit facility name" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="notice notice-warn">
          Renames this facility for all linked staff. To move one provider, use Change facility / placement.
        </div>
        <Field label="Facility name">
          <input required maxLength={255} value={name} onChange={event => setName(event.target.value)} />
        </Field>
        <Field label="Reason for correction">
          <textarea required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
        </Field>
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !name.trim() || reason.trim().length < 3}>
            {busy ? 'Saving…' : 'Save facility name'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
