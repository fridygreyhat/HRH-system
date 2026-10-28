import React, { useState } from 'react';
import { api, qs } from '../../api';
import { dateTime } from '../../format';
import { useApi } from '../../hooks';
import { AdminUser } from '../../types';
import { Alert, AsyncState, Field, Modal } from '../../components/ui';

export const RESET_CONFIRMATION = 'RESET NON-SUPER-ADMIN PASSWORDS';
interface LoginFailure { id: number; created_at: string; username: string; reason: string; message: string }

export function AccountRecovery({ users, onReset }: { users: AdminUser[] | null; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
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
    setOpen(false); setPassword(''); setConfirmation(''); setReason(''); setError('');
  };
  const reset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (confirmation !== RESET_CONFIRMATION || !users || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.post<{ reset_count: number; super_admins_unchanged: number }>('/admin/user-password-reset', {
        new_password: password, confirmation, expected_count: targets.length, reason,
      });
      setPassword(''); setConfirmation(''); setReason(''); setOpen(false);
      setNotice(`${result.reset_count} account passwords reset. ${result.super_admins_unchanged} Super Admin account(s) unchanged. Users must choose a new password at sign-in.`);
      onReset(); failures.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed. Refresh Users before retrying.');
    } finally { setBusy(false); }
  };
  return <div className="stack card">
    <div className="section-head">
      <div><h3>Account recovery</h3><p className="muted small">Super Admin only. Manage individual passwords with Manage → Reset password.</p></div>
      <button className="btn btn-secondary" disabled={!users || !targets.length} onClick={() => { setNotice(''); setOpen(true); }}>
        Reset all non-Super-Admin passwords
      </button>
    </div>
    <Alert kind="success">{notice}</Alert>
    <h4>Failed sign-ins</h4>
    <p className="muted small">See incorrect usernames, incorrect passwords, locked accounts and deactivated accounts. Passwords are never recorded.</p>
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
        <p>This will reset <strong>{targets.length} accounts</strong> in <strong>{window.location.hostname}</strong>. All {protectedCount} Super Admin account(s) will remain unchanged. This includes accounts hidden by the table filters.</p>
        <p>Existing sessions will end and lockouts will clear. Each user must choose a new password at sign-in. Deactivated accounts will remain deactivated.</p>
        <Alert kind="warn">A shared password is only for temporary recovery. Share it privately with the intended users.</Alert>
        <Field label="Temporary password"><input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></Field>
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
