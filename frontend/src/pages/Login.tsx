import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { BrandMark } from '../components/Icon';
import { Alert, Field } from '../components/ui';
import './polish-admin.css';

interface Meta {
  version: string;
}
/** The five approval steps, in both languages: the sign-in page is read before anyone picks a language. */
const STAGES: { en: string; sw: string }[] = [
  { en: 'Provider logs work', sw: 'Mtoa huduma anarekodi kazi' },
  { en: 'CTC or CSO Technical', sw: 'Uhakiki wa CTC au CSO' },
  { en: 'Technical review', sw: 'Mapitio ya kitaalamu' },
  { en: 'RM approves', sw: 'RM anaidhinisha' },
  { en: 'Finance and payment', sw: 'Fedha na malipo' },
];

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
          <div className="hero-copy">
            <h1>
              From reported work to <span className="hero-accent">verified payment</span>.
            </h1>
            <p className="hero-lead">Kumbukumbu za kazi, idhini na malipo ya watoa huduma wa afya, sehemu moja.</p>
          </div>
          <ol className="hero-pipeline" aria-label="Approval pipeline">
            {STAGES.map((s, i) => (
              <li key={s.en}>
                <span className="hero-step">{i + 1}</span>
                <span className="hero-step-text">
                  <span>{s.en}</span>
                  <span className="hero-step-sw" lang="sw">
                    {s.sw}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card stack" onSubmit={submit}>
          <div className="login-welcome">
            <h2>Karibu · Welcome</h2>
            <p className="muted">Ingia ili uendelee · Sign in to continue</p>
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
            {busy ? 'Signing in… / Inaingia…' : 'Sign in / Ingia'}
          </button>
          <div className="partner-bar" role="group" aria-label="Programme partners">
            <img
              src={`${process.env.PUBLIC_URL}/brand/tanzania-nembo.png`}
              alt="Nembo ya Taifa, United Republic of Tanzania"
              title="Nembo ya Taifa · Coat of arms of Tanzania (drawing: FischX, CC BY-SA 3.0)"
              className="partner-nembo"
            />
            <span className="partner-divider" aria-hidden="true" />
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
