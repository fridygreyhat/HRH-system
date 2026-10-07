import { useEffect, useState } from 'react';
import { api } from '../../api';

/** A loosely typed row from a configuration table. */
export type Row = Record<string, unknown>;

/** Load several lookup lists at once (e.g. regions and districts) keyed by their path. */
export function useLookups(paths: string[]) {
  const key = paths.join('|');
  const [lists, setLists] = useState<Record<string, Row[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(paths.length > 0);

  useEffect(() => {
    let alive = true;
    const list = key ? key.split('|') : [];
    if (!list.length) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    Promise.all(list.map((p) => api.get<Row[]>(p)))
      .then((results) => {
        if (!alive) return;
        setLists(Object.fromEntries(list.map((p, i) => [p, results[i]])));
        setError(null);
      })
      .catch((e: Error) => alive && setError(`Could not load reference lists: ${e.message}`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [key]);

  return { lists, error, loading };
}

/** Map id → display name for a lookup list. */
export function nameMap(rows: Row[] | undefined, label: (r: Row) => string = (r) => String(r.name ?? '')): Map<string, string> {
  const map = new Map<string, string>();
  (rows || []).forEach((r) => map.set(String(r.id), label(r)));
  return map;
}

/** Name for a foreign key, or a visible "unknown" marker so broken references are not hidden. */
export function refName(map: Map<string, string>, id: unknown): string {
  if (id === null || id === undefined || id === '') return '—';
  return map.get(String(id)) ?? `Unknown (#${String(id)})`;
}

/** Case-insensitive match of a search string against any of the given values. */
export function matches(query: string, ...values: unknown[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q));
}
