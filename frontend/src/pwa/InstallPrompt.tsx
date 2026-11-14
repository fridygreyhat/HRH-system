import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { pageLang } from '../components/ui';
import './pwa.css';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED = 'hrh_install_dismissed';
/** After "Later", the offer stays away this long. */
const QUIET_DAYS = 30;
/** Phones and tablets only: on a desktop the browser's own install icon is enough. */
const HANDHELD = '(max-width: 1100px), (pointer: coarse)';

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED) || 0);
    return Date.now() - at < QUIET_DAYS * 24 * 3600 * 1000;
  } catch {
    return false;
  }
}

// The browser makes its install offer once, soon after the page loads, often before Home is on screen. Keep it here
// so the Home page can show the bar whenever it opens.
let offer: InstallEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Called once at start-up: holds the browser's install offer until the Home page shows it. */
export function captureInstallOffer() {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    offer = e as InstallEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    changed();
  });
}

/**
 * "Install HRH Pay" as a slim one-line bar inside the Home page, on phones and tablets whose browser can install it.
 * It sits in the page, so it never covers a form, dialog or the menu. Hidden once installed, or for 30 days after "Later".
 */
export function InstallBar() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  if (!offer || dismissedRecently() || !window.matchMedia?.(HANDHELD).matches) return null;
  const event = offer;
  const sw = pageLang() === 'sw';
  const install = async () => {
    await event.prompt();
    await event.userChoice.catch(() => undefined);
    offer = null;
    changed();
  };
  const later = () => {
    try { localStorage.setItem(DISMISSED, String(Date.now())); } catch { /* private mode: just hide */ }
    changed();
  };
  return (
    <div className="install-bar no-print" role="region" aria-label={sw ? 'Sakinisha HRH Pay' : 'Install HRH Pay'}>
      <img src="/icons/icon-192.png" alt="" width={24} height={24} />
      <span className="install-bar-text">{sw ? 'Weka kwenye simu' : 'Add to this phone'}</span>
      <button type="button" className="btn btn-primary btn-sm" onClick={install}>{sw ? 'Sakinisha' : 'Install'}</button>
      <button type="button" className="icon-btn install-bar-later" onClick={later} aria-label={sw ? 'Baadaye' : 'Later'} title={sw ? 'Baadaye' : 'Later'}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
