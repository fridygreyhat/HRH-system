/**
 * Saving a timesheet day (or the submission) without internet: it is kept on the phone and sent, in order, as soon as
 * the connection is back. Days are sent before a waiting submission; if the server refuses a day, the submission waits
 * and the provider sees why.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { CHANGED_EVENT, enqueue, failItem, outbox, OutboxItem, pendingItems, removeItem, withPending } from './offlineStore';
import { WorkLogDetail } from './types';

export const SYNCED_EVENT = 'hrh-offline-synced';

/** No answer from the server at all: the phone is offline, or the link dropped. */
const unreachable = (e: unknown) => e instanceof ApiError && (e.status === 0 || [502, 503, 504].includes(e.status));

/** Save one day. Offline, it is kept on the phone and the timesheet shows it as waiting to be sent. */
export async function saveEntry(log: WorkLogDetail, date: string, body: Record<string, unknown>): Promise<{ log: WorkLogDetail; queued: boolean }> {
  try {
    return { log: await api.put<WorkLogDetail>(`/worklogs/${log.id}/entries/${date}`, body), queued: false };
  } catch (e) {
    if (!unreachable(e)) throw e;
    enqueue({ kind: 'entry', logId: log.id, date, body });
    return { log: withPending(`/worklogs/${log.id}`, log), queued: true };
  }
}

/** Submit the timesheet. Offline, the submission is kept and sent after the waiting days. */
export async function submitLog(log: WorkLogDetail, body: Record<string, unknown>): Promise<{ log: WorkLogDetail | null; queued: boolean }> {
  try {
    if (pendingItems().some((item) => item.logId === log.id && item.kind === 'entry')) throw new ApiError(0, 'days waiting');
    return { log: await api.post<WorkLogDetail>(`/worklogs/${log.id}/actions/submit`, body), queued: false };
  } catch (e) {
    if (!unreachable(e)) throw e;
    enqueue({ kind: 'submit', logId: log.id, body });
    return { log: null, queued: true };
  }
}

let running: Promise<number> | null = null;

/** Send everything waiting, oldest first. Returns how many were sent. */
export function syncOutbox(): Promise<number> {
  if (!running) running = send().finally(() => { running = null; });
  return running;
}

async function send(): Promise<number> {
  let sent = 0;
  for (const item of pendingItems().sort((a, b) => Number(a.kind === 'submit') - Number(b.kind === 'submit'))) {
    if (item.kind === 'submit' && outbox().some((other) => other.logId === item.logId && other.kind === 'entry')) {
      // A day of this timesheet was refused (or is still waiting): it must be put right before submitting.
      if (outbox().some((other) => other.logId === item.logId && other.kind === 'entry' && other.error)) {
        failItem(item.id, 'Not submitted: a day on this timesheet was not accepted. Correct it, then submit again.');
      }
      continue;
    }
    try {
      if (item.kind === 'entry') await api.put(`/worklogs/${item.logId}/entries/${item.date}`, item.body);
      else await api.post(`/worklogs/${item.logId}/actions/submit`, item.body);
      removeItem(item.id);
      sent += 1;
    } catch (e) {
      if (unreachable(e) || (e instanceof ApiError && e.status === 401)) break; // still offline, or sign in again first
      failItem(item.id, (e as Error).message);
    }
  }
  if (sent) window.dispatchEvent(new Event(SYNCED_EVENT));
  return sent;
}

/** What is waiting on this phone and what the server refused, kept up to date. */
export function useOutbox(): { waiting: OutboxItem[]; refused: OutboxItem[]; online: boolean } {
  const [items, setItems] = useState<OutboxItem[]>(() => outbox());
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const refresh = () => setItems(outbox());
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener(CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener(CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return { waiting: items.filter((item) => !item.error), refused: items.filter((item) => item.error), online };
}

/** Reload a view when waiting days have just been sent, so it shows what the server now holds. */
export function useReloadOnSync(reload: () => void): void {
  useEffect(() => {
    window.addEventListener(SYNCED_EVENT, reload);
    return () => window.removeEventListener(SYNCED_EVENT, reload);
  }, [reload]);
}
