import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { BrandMark, Icon } from '../components/Icon';
import { Alert, Field } from '../components/ui';

interface Meta {
  version: string;
}
const STAGES = ['Provider logs work', 'CTC or CSO Technical', 'Technical review', 'RM approves', 'Finance and payment'];

export function Login() {
  const { login, sessionExpired } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);

  useEffect(() => {
    api.get<Meta>('/meta').then(setMeta).catch(() => setMeta(null));
  }, []);

  const signIn = async (user: string, pass: string) => {
    setBusy(true);
    setError(null);
    try {
      await login(user.trim(), pass);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    signIn(username, password);
  };

  return (
    <main className="login">
      <section className="login-hero" aria-label="About HRH Pay">
        <div className="login-hero-inner">
          <div className="hero-brand">
            <BrandMark size={44} />
            <span>HRH Pay</span>
          </div>
          <h1>
            From reported work to <span className="hero-accent">verified payment</span>.
          </h1>
          <p className="hero-lead">Kumbukumbu za kazi, idhini na malipo ya watoa huduma wa afya, sehemu moja.</p>
          <ol className="hero-pipeline" aria-label="Approval pipeline">
            {STAGES.map((s, i) => (
              <li key={s}>
                <span className="hero-step">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <ul className="hero-points">
            <li><Icon name="shield" />Every approval is on the record</li>
            <li><Icon name="route" />Approved is never shown as paid</li>
            <li><Icon name="phone" />Made for phones, in Kiswahili and English</li>
          </ul>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card stack" onSubmit={submit}>
          <div className="login-welcome">
            <h2>Karibu · Welcome</h2>
            <p className="muted">Ingia ili kuendelea · Sign in to continue</p>
          </div>
          {sessionExpired && <Alert kind="info">Your session expired. Please sign in again.</Alert>}
          <Alert>{error}</Alert>
          <Field label="Username / Jina la mtumiaji">
            <input autoFocus autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="Password / Nenosiri">
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in / Ingia'}
          </button>
          <div className="partner-bar" role="group" aria-label="Programme partners">
            <img src={`${process.env.PUBLIC_URL}/brand/usa-mark.png`} alt="United States of America" className="partner-usa" />
            <span className="partner-divider" aria-hidden="true" />
            <img src={`${process.env.PUBLIC_URL}/brand/fhi360-logo.png`} alt="FHI 360" className="partner-fhi" />
          </div>
          {meta && <p className="muted small login-version">Version {meta.version}</p>}
        </form>
      </section>
    </main>
  );
}
