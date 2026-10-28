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
          This renames the shared facility for all linked staff. It does not move this provider or change the facility’s ward,
          ownership or location settings. To move one provider, use Change facility / placement instead.
        </div>
        <Field label="Facility name">
          <input required maxLength={255} value={name} onChange={event => setName(event.target.value)} />
        </Field>
        <Field label="Reason for correction">
          <textarea required minLength={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} />
        </Field>
        <p className="muted small">For ward, ownership/type or geofence settings, use Administration → Configuration → Facilities.</p>
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
