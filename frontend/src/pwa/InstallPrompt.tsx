import React, { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import './pwa.css';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED = 'hrh_install_dismissed';
/** Phones and tablets only: on a desktop the browser's own install icon is enough. */
const HANDHELD = '(max-width: 1100px), (pointer: coarse)';

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED) || 0);
    return Date.now() - at < 14 * 24 * 3600 * 1000;
  } catch {
    return false;
  }
}

/** Offers "Install HRH Pay" on phones and tablets whose browser supports installing; hidden once installed or dismissed. */
export function InstallPrompt() {
  const { lang } = useAuth();
  const [event, setEvent] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const offer = (e: Event) => {
      e.preventDefault();
      if (!dismissedRecently() && window.matchMedia?.(HANDHELD).matches) setEvent(e as InstallEvent);
    };
    const installed = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  if (!event) return null;
  const sw = lang === 'sw';
  const install = async () => {
    await event.prompt();
    await event.userChoice.catch(() => undefined);
    setEvent(null);
  };
  const later = () => {
    try { localStorage.setItem(DISMISSED, String(Date.now())); } catch { /* private mode: just hide */ }
    setEvent(null);
  };
  return (
    <div className="install-prompt" role="dialog" aria-label={sw ? 'Sakinisha HRH Pay' : 'Install HRH Pay'}>
      <img src="/icons/icon-192.png" alt="" width={40} height={40} />
      <div className="install-text">
        <strong>{sw ? 'Sakinisha HRH Pay' : 'Install HRH Pay'}</strong>
        <span>{sw ? 'Ifungue kama programu kwenye simu au tablet.' : 'Open it like an app on this phone or tablet.'}</span>
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={install}>{sw ? 'Sakinisha' : 'Install'}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={later}>{sw ? 'Baadaye' : 'Later'}</button>
    </div>
  );
}
