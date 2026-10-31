import React, { useState } from 'react';
import { api } from '../api';
import { dateOnly } from '../format';
import { useAction, useApi } from '../hooks';
import { PayPeriod, ProviderPeriodRecord, ProviderPeriodRecordsResponse } from '../types';
import { Alert, Field, Modal, StatusBadge } from '../components/ui';

export function ProviderPeriodRecords({ period, onClose }: { period: PayPeriod; onClose: () => void }) {
  const records = useApi<ProviderPeriodRecordsResponse>(`/admin/pay-periods/${period.id}/provider-records`);
  const reset = useAction();
  const [selected, setSelected] = useState<ProviderPeriodRecord | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const expectedConfirmation = selected ? `RESET ${selected.username} ${period.id}` : '';
  const resetProvider = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const result = await reset.run(() => api.post(
      `/admin/pay-periods/${period.id}/providers/${selected.staff_id}/reset-records`,
      { reason: reason.trim(), confirmation },
    ));
    if (result) {
      setNotice(`${selected.staff_name}'s records were reset. The pay period and account were kept.`);
      setSelected(null);
      setReason('');
      setConfirmation('');
      await records.reload();
    }
  };

  return (
    <Modal title={`Provider records · ${period.period_label || 'Pay period'}`} onClose={() => { if (!reset.busy) onClose(); }}>
      <div className="stack">
        <p className="muted small">
          {dateOnly(period.start_date)} – {dateOnly(period.end_date)}
          {period.region_name ? ` · ${period.region_name}` : ' · Global schedule'}
        </p>
        <div className="notice notice-info">
          Reset clears the selected provider’s current daily entries and returns their work records to Draft.
          The account, shared pay period, and approval/audit snapshots remain. Records with payment claims or paid status are protected.
        </div>
        {period.status === 'CLOSED' && <Alert kind="warn">This period is closed. After a reset, reopen it before the provider can submit again.</Alert>}
        {period.status === 'ARCHIVED' && <Alert kind="warn">Archived periods are read-only and cannot be reset.</Alert>}
        <Alert>{records.error || reset.error}</Alert>
        <Alert kind="success">{notice}</Alert>
        {records.loading && !records.data ? (
          <div className="loading" style={{ minHeight: 72 }} aria-label="Loading provider records" />
        ) : records.data?.providers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Provider</th><th>Work types</th><th>Days · hours</th><th>Reset</th></tr>
              </thead>
              <tbody>
                {records.data.providers.map((provider) => (
                  <tr key={provider.staff_id}>
                    <td>
                      <strong>{provider.staff_name}</strong>
                      <div className="muted small">{provider.username} · {provider.cadre_code}</div>
                    </td>
                    <td>
                      {provider.work_logs.map((log) => (
                        <div key={log.id} className="row" style={{ gap: '.35rem', marginBottom: '.25rem' }}>
                          <span>{log.work_type === 'PAYROLL' ? 'Payroll' : log.work_type === 'SERVICES' ? 'Services' : 'Legacy'}</span>
                          <StatusBadge status={log.status} />
                        </div>
                      ))}
                    </td>
                    <td>
                      {provider.work_logs.map((log) => (
                        <div key={log.id}>{log.entry_count} days · {log.total_hours} hours</div>
                      ))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={!provider.can_reset || reset.busy}
                        title={provider.reset_block_reason || 'Clear this provider’s records for this period'}
                        onClick={() => {
                          setSelected(provider);
                          setReason('');
                          setConfirmation('');
                          reset.setError(null);
                        }}
                      >
                        Reset records
                      </button>
                      {!provider.can_reset && provider.reset_block_reason && (
                        <div className="muted small" style={{ maxWidth: 240, marginTop: '.3rem' }}>{provider.reset_block_reason}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No provider records in this period</h3>
            <p className="muted">There are no Services or Payroll work records to reset.</p>
          </div>
        )}
        {records.error && <button type="button" className="btn btn-secondary btn-sm" onClick={records.reload}>Retry</button>}
        {selected && (
          <form className="card stack" onSubmit={resetProvider}>
            <h3>Reset {selected.staff_name}</h3>
            <Alert kind="warn">
              This clears {selected.work_logs.reduce((sum, log) => sum + log.entry_count, 0)} daily entries across
              {' '}{selected.work_logs.length} work record(s). The provider can refill them in the same period once it is open.
              Approval snapshots and audit events remain available to Super Admin.
            </Alert>
            <Field label="Reason for reset">
              <textarea required minLength={3} maxLength={1000} value={reason} disabled={reset.busy}
                onChange={(event) => setReason(event.target.value)} />
            </Field>
            <Field label={`Type ${expectedConfirmation} to confirm`}>
              <input required autoComplete="off" value={confirmation} disabled={reset.busy}
                onChange={(event) => setConfirmation(event.target.value)} />
            </Field>
            <div className="row">
              <button type="submit" className="btn btn-danger"
                disabled={reset.busy || reason.trim().length < 3 || confirmation !== expectedConfirmation}>
                {reset.busy ? 'Resetting…' : 'Reset provider records'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={reset.busy} onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
