import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { BrandMark } from '../components/Icon';
import { Alert, Field } from '../components/ui';

/**
 * Change password. `forced` is the full-screen version shown after an administrator issued a temporary password;
 * the server refuses every other request until it is done.
 */
export function ChangePasswordForm({ forced = false, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { changePassword, logout, me, lang } = useAuth();
  // The forced screen keeps both languages: it is the first thing a new login sees.
  const text = (en: string, sw: string) => (forced ? `${en} / ${sw}` : lang === 'sw' ? sw : en);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      {forced && (
        <Alert kind="info">
          {me?.full_name}, choose your own password to continue. / Chagua nenosiri lako ili kuendelea.
        </Alert>
      )}
      <Alert>{error}</Alert>
      <Field label={forced ? text('Temporary password', 'Nenosiri la muda') : text('Current password', 'Nenosiri la sasa')}>
        <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
      </Field>
      <Field label={text('New password', 'Nenosiri jipya')} hint={lang === 'sw' && !forced ? 'Angalau herufi 8; isiwe jina lako la mtumiaji.' : 'At least 8 characters; not your username.'}>
        <input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label={text('Repeat new password', 'Rudia nenosiri jipya')} hint={mismatch ? (lang === 'sw' && !forced ? 'Manenosiri hayalingani.' : 'The passwords do not match.') : undefined}>
        <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
      </Field>
      <p className="muted small">{lang === 'sw' && !forced ? 'Kubadilisha nenosiri kunakutoa kwenye vifaa vingine vyote.' : 'Changing your password signs you out on every other device.'}</p>
      <div className="row">
        <button className="btn btn-primary" disabled={busy || mismatch || next.length < 8}>
          {busy ? (lang === 'sw' && !forced ? 'Inahifadhi…' : 'Saving…') : text('Change password', 'Badilisha nenosiri')}
        </button>
        {forced && (
          <button type="button" className="btn btn-ghost" onClick={logout}>
            {text('Sign out', 'Toka')}
          </button>
        )}
      </div>
    </form>
  );
}

export function ForcedPasswordChange() {
  return (
    <main className="login-panel forced-pw">
      <div className="login-card card stack">
        <div className="login-mobile-brand" style={{ display: 'flex' }}>
          <BrandMark size={36} />
          <strong>HRH Pay</strong>
        </div>
        <h2>Set your password / Weka nenosiri lako</h2>
        <ChangePasswordForm forced />
      </div>
    </main>
  );
}
