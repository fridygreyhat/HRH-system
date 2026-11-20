/**
 * What a provider's phone keeps so the app works without internet: their own sign-in details, their own timesheets
 * as last seen, and the days (and submissions) saved while offline that are still waiting to be sent.
 * Nothing is kept for other people's records. Everything here is deleted at sign-out, and when someone else signs in.
 */
import { WorkLogDetail, WorkLogEntry } from './types';

const PREFIX = 'hrh_off:';
const OWNER = `${PREFIX}owner`;
const OUTBOX = `${PREFIX}outbox`;
export const CHANGED_EVENT = 'hrh-offline-changed';

/** Reads kept for offline use, by exact path. */
const READS = [/^\/auth\/me$/, /^\/worklogs\?mine=true$/, /^\/worklogs\/\d+$/, /^\/admin\/pay-periods$/];
const LOG_PATH = /^\/worklogs\/(\d+)$/;

export interface OutboxItem {
  id: string;
  kind: 'entry' | 'submit';
  /** Who saved it: it is only ever sent with that person's sign-in. */
  owner: number;
  logId: number;
  date?: string;
  body: Record<string, unknown>;
  queuedAt: string;
  /** Set when the server refused it, with the reason to show the provider. */
  error?: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | undefined {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked store only means this copy is not kept; the online app still works.
  }
}

function changed(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

interface CachedMe { id: number; roles: string[]; staff?: { id: number } | null }

const cachedMe = (): CachedMe | undefined => read<CachedMe>(`${PREFIX}/auth/me`);

/** The signed-in person whose records this phone keeps. */
export const offlineOwner = (): number | undefined => read<number>(OWNER);

export function isOfflineRead(path: string): boolean {
  return READS.some((pattern) => pattern.test(path));
}

/** Keep a provider's own read for offline use. Someone else's timesheet (a reviewer's view) is never kept. */
export function remember(path: string, data: unknown): void {
  if (!isOfflineRead(path) || data === undefined || data === null) return;
  if (path === '/auth/me') {
    const me = data as CachedMe;
    const owner = offlineOwner();
    if (owner !== undefined && owner !== me.id) clearOffline(); // another person on this phone: nothing of theirs stays
    write(OWNER, me.id);
    write(`${PREFIX}${path}`, data);
    return;
  }
  const me = cachedMe();
  if (!me || !me.roles.includes('PROVIDER')) return;
  const log = LOG_PATH.exec(path);
  if (log && (data as WorkLogDetail).staff?.id !== me.staff?.id) return;
  write(`${PREFIX}${path}`, data);
}

/** The kept copy of a read, with the days still waiting to be sent shown on it. */
export function recall<T>(path: string): T | undefined {
  const data = read<T>(`${PREFIX}${path}`);
  return data === undefined ? undefined : withPending(path, data);
}

export function clearOffline(): void {
  const store = storage();
  if (!store) return;
  Object.keys(store).filter((key) => key.startsWith(PREFIX)).forEach((key) => store.removeItem(key));
  changed();
}

export function outbox(): OutboxItem[] {
  const owner = offlineOwner();
  return (read<OutboxItem[]>(OUTBOX) || []).filter((item) => item.owner === owner);
}

function saveOutbox(items: OutboxItem[]): void {
  write(OUTBOX, items);
  changed();
}

export function enqueue(item: Omit<OutboxItem, 'id' | 'queuedAt' | 'owner'>): OutboxItem {
  const owner = offlineOwner();
  if (owner === undefined) throw new Error('Sign in again before saving offline.');
  // A later save of the same day (or a second submission) replaces the earlier one.
  const rest = outbox().filter((other) => !(other.logId === item.logId && other.kind === item.kind && other.date === item.date));
  const queued: OutboxItem = { ...item, owner, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, queuedAt: new Date().toISOString() };
  saveOutbox([...rest, queued]);
  return queued;
}

export function removeItem(id: string): void {
  saveOutbox(outbox().filter((item) => item.id !== id));
}

export function failItem(id: string, error: string): void {
  saveOutbox(outbox().map((item) => (item.id === id ? { ...item, error } : item)));
}

/** Days and submissions waiting to be sent (not refused). */
export const pendingItems = (): OutboxItem[] => outbox().filter((item) => !item.error);

function hoursOf(body: Record<string, unknown>): number {
  if (typeof body.hours_worked === 'number') return body.hours_worked;
  const [start, end] = [body.start_time, body.end_time].map((value) => String(value || ''));
  const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + (m || 0); };
  return start && end ? Math.max(0, (minutes(end) - minutes(start)) / 60) : 0;
}

/** A timesheet with its waiting days shown as they will be once sent. */
export function withPending<T>(path: string, data: T): T {
  const match = LOG_PATH.exec(path);
  if (!match) return data;
  const logId = Number(match[1]);
  const days = pendingItems().filter((item) => item.kind === 'entry' && item.logId === logId);
  if (!days.length) return data;
  const log = data as unknown as WorkLogDetail;
  const entries = new Map(log.entries.map((entry) => [entry.entry_date, entry]));
  for (const day of days) {
    const body = day.body;
    const earlier = entries.get(day.date!);
    entries.set(day.date!, {
      ...(earlier || {}),
      id: earlier?.id ?? -1,
      entry_date: day.date!,
      activity_key: (body.activity_key as string) ?? null,
      activity_location: (body.activity_location as string) ?? null,
      start_time: (body.start_time as string) ?? null,
      end_time: (body.end_time as string) ?? null,
      hours_worked: hoursOf(body),
      evidence_text: (body.evidence_text as string) ?? '',
      comment: (body.comment as string) ?? null,
      gps_captured_at: null,
      location_status: 'NOT_SENT',
      measures: (body.measures as Record<string, number>) || {},
      location_exception: false,
      pending: true,
    } as WorkLogEntry);
  }
  const all = Array.from(entries.values()).sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  return {
    ...log,
    entries: all,
    totals: { ...log.totals, days: all.length, hours: all.reduce((sum, entry) => sum + Number(entry.hours_worked || 0), 0) },
  } as unknown as T;
}
