import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { cadreName, dateOnly, num, workHours } from '../format';
import { useAction, useApi } from '../hooks';
import { PayPeriod, ProviderPeriodRecord, ProviderPeriodRecordsResponse } from '../types';
import { Alert, Field, Modal, PersonCell, StatusBadge, WorkTypeChip } from '../components/ui';
import './polish-provider.css';

export function ProviderPeriodRecords({ period, onClose }: { period: PayPeriod; onClose: () => void }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
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
      setNotice(sw
        ? `Rekodi za ${selected.staff_name} zimewekwa upya.`
        : `${selected.staff_name}'s records were reset.`);
      setSelected(null);
      setReason('');
      setConfirmation('');
      await records.reload();
    }
  };

  return (
    <Modal title={sw ? `Rekodi za watoa huduma · ${period.period_label || 'Kipindi cha malipo'}` : `Provider records · ${period.period_label || 'Pay period'}`} onClose={() => { if (!reset.busy) onClose(); }}>
      <div className="stack">
        <p className="muted small">
          {dateOnly(period.start_date)} – {dateOnly(period.end_date)}
          {period.region_name ? ` · ${period.region_name}` : (sw ? ' · Ratiba ya jumla' : ' · Global schedule')}
        </p>
        <p className="muted small">
          {sw
            ? 'Kuweka upya kunarudisha rekodi kuwa Rasimu; kumbukumbu za idhini/ukaguzi zinabaki.'
            : 'Reset returns records to Draft; approval/audit snapshots remain.'}
        </p>
        {period.status === 'CLOSED' && <Alert kind="warn">{sw ? 'Kipindi hiki kimefungwa. Kifungue baada ya kuweka upya ili mtoa huduma awasilishe.' : 'This period is closed. Reopen it after reset so the provider can submit.'}</Alert>}
        {period.status === 'ARCHIVED' && <Alert kind="warn">{sw ? 'Vipindi vilivyowekwa kwenye kumbukumbu ni vya kusoma tu na haviwezi kuwekwa upya.' : 'Archived periods are read-only and cannot be reset.'}</Alert>}
        <Alert>{records.error || reset.error}</Alert>
        <Alert kind="success">{notice}</Alert>
        {records.loading && !records.data ? (
          <div className="loading" style={{ minHeight: 72 }} aria-label={sw ? 'Inapakia rekodi za watoa huduma' : 'Loading provider records'} />
        ) : records.data?.providers.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{sw ? 'Mtoa huduma' : 'Provider'}</th><th>{sw ? 'Aina za kazi' : 'Work types'}</th><th className="num">{sw ? 'Siku · masaa' : 'Days · hours'}</th><th>{sw ? 'Weka upya' : 'Reset'}</th></tr>
              </thead>
              <tbody>
                {records.data.providers.map((provider) => (
                  <tr key={provider.staff_id}>
                    <td>
                      <PersonCell name={provider.staff_name} sub={`${provider.username} · ${cadreName(provider.cadre_code, lang, true)}`} />
                    </td>
                    <td>
                      {provider.work_logs.map((log) => (
                        <div key={log.id} className="row period-record-type">
                          <WorkTypeChip type={log.work_type} />
                          <StatusBadge kind="log" status={log.status} bare />
                        </div>
                      ))}
                    </td>
                    <td className="num">
                      {provider.work_logs.map((log) => (
                        <div key={log.id} className="nowrap period-record-figures">{sw ? `Siku ${num(log.entry_count)} · masaa ${workHours(log.total_hours)}` : `${num(log.entry_count)} days · ${workHours(log.total_hours)} h`}</div>
                      ))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={!provider.can_reset || reset.busy}
                        title={provider.reset_block_reason || (sw ? 'Futa rekodi za mtoa huduma huyu kwa kipindi hiki' : 'Clear this provider’s records for this period')}
                        onClick={() => {
                          setSelected(provider);
                          setReason('');
                          setConfirmation('');
                          reset.setError(null);
                        }}
                      >
                        {sw ? 'Weka upya rekodi' : 'Reset records'}
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
            <h3>{sw ? 'Hakuna rekodi za watoa huduma katika kipindi hiki' : 'No provider records in this period'}</h3>
          </div>
        )}
        {records.error && <button type="button" className="btn btn-secondary btn-sm" onClick={records.reload}>{sw ? 'Jaribu tena' : 'Retry'}</button>}
        {selected && (
          <form className="card stack" onSubmit={resetProvider}>
            <h3>{sw ? 'Weka upya rekodi za' : 'Reset'} {selected.staff_name}</h3>
            <Alert kind="warn">
              {sw ? (
                `Hatua hii inafuta taarifa ${selected.work_logs.reduce((sum, log) => sum + log.entry_count, 0)} za kila siku katika rekodi ${selected.work_logs.length} za kazi.`
              ) : (
                <>
                  This clears {selected.work_logs.reduce((sum, log) => sum + log.entry_count, 0)} daily entries across
                  {' '}{selected.work_logs.length} work record(s).
                </>
              )}
            </Alert>
            <Field label={sw ? 'Sababu ya kuweka upya' : 'Reason for reset'}>
              <textarea required minLength={3} maxLength={1000} value={reason} disabled={reset.busy}
                onChange={(event) => setReason(event.target.value)} />
            </Field>
            <Field label={sw ? `Andika ${expectedConfirmation} ili kuthibitisha` : `Type ${expectedConfirmation} to confirm`}>
              <input required autoComplete="off" value={confirmation} disabled={reset.busy}
                onChange={(event) => setConfirmation(event.target.value)} />
            </Field>
            <div className="row">
              <button type="submit" className="btn btn-danger"
                disabled={reset.busy || reason.trim().length < 3 || confirmation !== expectedConfirmation}>
                {reset.busy ? (sw ? 'Inaweka upya…' : 'Resetting…') : (sw ? 'Weka upya rekodi za mtoa huduma' : 'Reset provider records')}
              </button>
              <button type="button" className="btn btn-ghost" disabled={reset.busy} onClick={() => setSelected(null)}>{sw ? 'Ghairi' : 'Cancel'}</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
