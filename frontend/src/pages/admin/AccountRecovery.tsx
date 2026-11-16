import React, { useState } from 'react';
import { api, qs } from '../../api';
import { dateTime } from '../../format';
import { useApi } from '../../hooks';
import { AdminUser } from '../../types';
import { Alert, AsyncState, Field, Modal } from '../../components/ui';

export const RESET_CONFIRMATION = 'RESET NON-SUPER-ADMIN PASSWORDS';
interface IssuedPassword { username: string; full_name: string; phone: string | null; temporary_password: string }

/** The one copy of the new passwords: a CSV file saved on this computer. */
function saveIssued(rows: IssuedPassword[]) {
  const cell = (value: string | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const text = ['Username,Full name,Phone,Temporary password', ...rows.map(r => [r.username, r.full_name, r.phone, r.temporary_password].map(cell).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `temporary-passwords-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
interface LoginFailure { id: number; created_at: string; username: string; reason: string; message: string }

export function AccountRecovery({ users, onReset }: { users: AdminUser[] | null; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [username, setUsername] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const failures = useApi<LoginFailure[]>(`/admin/login-failures${qs({ username: filter })}`);
  const targets = (users || []).filter(user => !user.roles.includes('SUPER_ADMIN'));
  const protectedCount = (users || []).length - targets.length;
  const close = () => {
    if (busy) return;
    setOpen(false); setConfirmation(''); setReason(''); setError('');
  };
  const reset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (confirmation !== RESET_CONFIRMATION || !users || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.post<{ reset_count: number; super_admins_unchanged: number; passwords: IssuedPassword[] }>('/admin/user-password-reset', {
        confirmation, expected_count: targets.length, reason,
      });
      saveIssued(result.passwords);
      setConfirmation(''); setReason(''); setOpen(false);
      setNotice(`${result.reset_count} accounts reset, each with its own temporary password (downloaded as a file, shown only once). `
        + `${result.super_admins_unchanged} Super Admin account(s) unchanged. Give each person only their own password; they choose a new one at sign-in. Delete the file afterwards.`);
      onReset(); failures.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed. Refresh Users before retrying.');
    } finally { setBusy(false); }
  };
  return <div className="stack card">
    <div className="section-head">
      <div><h3>Account recovery</h3></div>
      <button className="btn btn-secondary" disabled={!users || !targets.length} onClick={() => { setNotice(''); setOpen(true); }}>
        Reset all non-Super-Admin passwords
      </button>
    </div>
    <Alert kind="success">{notice}</Alert>
    <h4>Failed sign-ins</h4>
    <form className="row" onSubmit={event => { event.preventDefault(); setFilter(username.trim()); failures.reload(); }}>
      <Field label="Username"><input value={username} onChange={event => setUsername(event.target.value)} placeholder="All usernames" /></Field>
      <button className="btn btn-secondary" type="submit">Find failures</button>
      <button className="btn btn-secondary" type="button" onClick={() => failures.reload()}>Refresh failures</button>
    </form>
    <AsyncState data={failures.data} error={failures.error} loading={failures.loading} empty="No failed sign-ins found.">
      {rows => <div className="table-wrap"><table className="table">
        <thead><tr><th>Time</th><th>Username</th><th>Failure and next action</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><td>{dateTime(row.created_at)}</td><td>{row.username}</td><td>{row.message}</td></tr>)}</tbody>
      </table></div>}
    </AsyncState>
    {open && <Modal title="Reset non-Super-Admin passwords" onClose={close}>
      <form className="stack" onSubmit={reset}>
        <Alert>{error}</Alert>
        <p>This will reset <strong>{targets.length} accounts</strong> in <strong>{window.location.hostname}</strong>, including filtered-out ones. All {protectedCount} Super Admin account(s) will remain unchanged.</p>
        <p>Sessions end; users must choose a new password at sign-in.</p>
        <Alert kind="warn">Each account gets its own random temporary password. The list downloads once as a file: give each person only their own, privately, then delete the file.</Alert>
        <Field label="Reason for reset"><textarea required minLength={10} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></Field>
        <Field label={`Type ${RESET_CONFIRMATION}`}><input required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" /></Field>
        <div className="row">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || confirmation !== RESET_CONFIRMATION}>{busy ? 'Resetting passwords…' : 'Confirm password reset'}</button>
        </div>
      </form>
    </Modal>}
  </div>;
}
