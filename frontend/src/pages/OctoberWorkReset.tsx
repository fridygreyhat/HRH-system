import React, { useState } from 'react';
import { api } from '../api';
import { useAction, useApi } from '../hooks';
import { Alert, Field, Modal } from '../components/ui';

interface ResetPreview {
  period_label: string | null;
  counts: {
    work_logs: number; work_logs_to_reset: number; daily_entries: number;
    indicator_values: number; budget_lines_preserved: number; claims: number;
  };
  blockers: string[];
  preview_token: string;
  confirmation: string;
  can_reset: boolean;
}

export function OctoberWorkReset({ periodId, onClose, onDone }: {
  periodId: number; onClose: () => void; onDone: () => void;
}) {
  const preview = useApi<ResetPreview>(`/admin/pay-periods/${periodId}/work-reset-preview`);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('Restart October 2026 with empty work records.');
  const [acknowledged, setAcknowledged] = useState(false);
  const action = useAction();
  const host = typeof window === 'undefined' ? '' : window.location.hostname;
  const isPreview = !host || host.endsWith('.replit.dev') || ['localhost', '127.0.0.1'].includes(host);
  const data = preview.data;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data || isPreview || !acknowledged || confirmation !== data.confirmation || !data.can_reset) return;
    const result = await action.run(() => api.post(`/admin/pay-periods/${periodId}/clear-work-records`, {
      confirmation, reason: reason.trim(), preview_token: data.preview_token,
    }));
    if (result) onDone();
  };
  return <Modal title="Clear October 2026 work records" onClose={() => { if (!action.busy) onClose(); }}>
    <form className="stack" onSubmit={submit}>
      <p className="alert alert-warn"><strong>This clears active October work entries and returns the work logs to empty drafts.</strong> Current submissions and approvals will no longer apply. Historical audit records and a pre-reset snapshot are retained.</p>
      <p className="notice notice-info"><strong>Preserved:</strong> October’s pay period, budget allocation, budget ledger, staff accounts, placements and all other months.</p>
      <p className="small">Target app: <strong>{host || 'Not available'}</strong></p>
      {isPreview && <Alert kind="warn">This is the development preview. Open the published app and sign in as Super Admin to clear live October records. Preview records will not be changed here.</Alert>}
      <Alert>{preview.error || action.error}</Alert>
      {preview.loading && <p>Checking October work records and financial safeguards…</p>}
      {data && <>
        <dl className="detail-list">
          <dt>Work logs to reset</dt><dd>{data.counts.work_logs_to_reset} of {data.counts.work_logs}</dd>
          <dt>Daily entries to clear</dt><dd>{data.counts.daily_entries}</dd>
          <dt>Indicator values to clear</dt><dd>{data.counts.indicator_values}</dd>
          <dt>Budget lines preserved</dt><dd>{data.counts.budget_lines_preserved}</dd>
          <dt>Payment claims</dt><dd>{data.counts.claims}</dd>
        </dl>
        {data.blockers.length > 0 && <div className="alert alert-error"><ul>{data.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul></div>}
        {!data.can_reset && data.blockers.length === 0 && <p className="notice notice-info">October work logs are already empty. No reset is needed.</p>}
        <Field label="Reason for clearing work records">
          <textarea required minLength={10} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={action.busy} />
        </Field>
        <label className="check-row"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={action.busy} />
          I understand that providers must fill and submit October work again, and previous approvals will not count.
        </label>
        <Field label={`Type ${data.confirmation} to confirm`}>
          <input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={action.busy} />
        </Field>
      </>}
      <div className="row">
        <button type="submit" className="btn btn-danger" disabled={isPreview || action.busy || !data?.can_reset || !acknowledged || confirmation !== data.confirmation || reason.trim().length < 10}>
          {action.busy ? 'Clearing October work…' : 'Clear October work records'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={action.busy} onClick={() => { setConfirmation(''); setAcknowledged(false); preview.reload(); }}>Refresh safety check</button>
        <button type="button" className="btn btn-ghost" disabled={action.busy} onClick={onClose}>Cancel</button>
      </div>
    </form>
  </Modal>;
}
