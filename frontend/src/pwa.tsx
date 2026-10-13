import React, { useEffect, useState } from 'react';
import { Icon } from './components/Icon';

/** Progressive web app: service worker registration, the install prompt and an offline notice. */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// The browser may offer installation before any component mounts, so capture it at module load.
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own button instead of the browser's mini-infobar
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export function registerServiceWorker(): void {
  // Production builds only: the development server reloads files itself and must not be cached.
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/sw.js`).catch(() => undefined);
  });
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** "Install app" where the browser supports it; on iPhone/iPad, how to add it to the Home Screen. Hidden once installed. */
export function InstallButton({ variant = 'icon' }: { variant?: 'icon' | 'button' }) {
  const [, rerender] = useState(0);
  const [showIosHelp, setShowIosHelp] = useState(false);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (isStandalone()) return null;
  const ios = isIos();
  if (!deferred && !ios) return null;

  const install = async () => {
    if (deferred) {
      const prompt = deferred;
      await prompt.prompt();
      await prompt.userChoice;
      deferred = null;
      notify();
    } else {
      setShowIosHelp((v) => !v);
    }
  };

  const help = showIosHelp && (
    <p className="notice notice-info small install-help" role="note">
      On iPhone or iPad: tap the Share button, then <b>Add to Home Screen</b>. / Gusa kitufe cha Share, kisha <b>Add to Home Screen</b>.
    </p>
  );

  if (variant === 'button')
    return (
      <>
        <button type="button" className="btn btn-secondary" onClick={install}>
          <Icon name="download" size={18} /> Install app / Sakinisha programu
        </button>
        {help}
      </>
    );
  return (
    <span className="install-wrap">
      <button type="button" className="icon-btn" onClick={install} aria-label="Install app" title="Install HRH Pay on this device">
        <Icon name="download" />
      </button>
      {help}
    </span>
  );
}

/** A banner while the device has no connection: the app still opens, but nothing can be loaded or saved. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      You are offline. Nothing can be loaded or saved until the connection returns. / Huna mtandao. Hakuna kinachoweza kupakiwa au kuhifadhiwa hadi mtandao urudi.
    </div>
  );
}
