import React, { useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { dateOnly } from '../format';
import { syncOutbox, useOutbox } from '../offline';
import { removeItem } from '../offlineStore';

const RETRY_MS = 30_000;

/**
 * Sends what was saved without internet as soon as the connection is back (and keeps trying every 30 seconds), and
 * tells the provider what is still on the phone and anything the server refused, with the reason.
 */
export function OfflineSync() {
  const { me, lang } = useAuth();
  const { waiting, refused, online } = useOutbox();
  const sw = lang === 'sw';
  const provider = !!me?.roles.includes('PROVIDER');

  useEffect(() => {
    if (online && waiting.length) syncOutbox();
    if (!waiting.length) return undefined;
    const timer = window.setInterval(() => { if (navigator.onLine !== false) syncOutbox(); }, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [online, waiting.length]);

  useEffect(() => {
    // Keep the timesheet screens on the phone (the service worker saves them), so they open after install without internet.
    if (provider && online) import('../pages/MyWorkLogs').catch(() => undefined);
  }, [provider, online]);

  if (!provider) return null;
  const days = waiting.filter((item) => item.kind === 'entry').length;
  const submissions = waiting.length - days;
  const what = sw
    ? [days ? `siku ${days}` : '', submissions ? `uwasilishaji ${submissions}` : ''].filter(Boolean).join(' na ')
    : [days ? `${days} ${days === 1 ? 'day' : 'days'}` : '', submissions ? `${submissions} ${submissions === 1 ? 'submission' : 'submissions'}` : ''].filter(Boolean).join(' and ');

  return (
    <>
      {!online && (
        <div className="alert alert-warn offline-banner" role="status">
          <strong>{sw ? 'Hakuna mtandao.' : 'You are offline.'}</strong>{' '}
          {waiting.length
            ? (sw ? `${what} zimehifadhiwa kwenye simu hii; zitatumwa wenyewe mtandao ukirudi.` : `${what} saved on this phone; ${waiting.length === 1 ? 'it is sent by itself' : 'they are sent by themselves'} when you are back online.`)
            : (sw ? 'Bado unaweza kujaza siku; zinahifadhiwa kwenye simu hii hadi mtandao urudi.' : 'You can still record days; they are kept on this phone until you are back online.')}
        </div>
      )}
      {online && waiting.length > 0 && (
        <div className="alert alert-info offline-banner" role="status">
          {sw ? `Inatuma ${what} zilizohifadhiwa bila mtandao…` : `Sending ${what} saved while offline…`}
        </div>
      )}
      {refused.map((item) => (
        <div key={item.id} className="alert alert-error offline-banner" role="alert">
          <strong>{item.kind === 'entry'
            ? (sw ? `Siku ${dateOnly(item.date!)} haikukubaliwa: ` : `${dateOnly(item.date!)} was not accepted: `)
            : (sw ? 'Uwasilishaji haukukubaliwa: ' : 'Submission not accepted: ')}</strong>
          {item.error}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeItem(item.id)}>
            {sw ? 'Sawa, nitarekebisha' : 'OK, I will correct it'}
          </button>
        </div>
      ))}
    </>
  );
}
