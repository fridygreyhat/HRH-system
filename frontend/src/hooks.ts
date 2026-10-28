import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Fetch `path` on mount and whenever it changes; `reload` refetches. Pass null to skip. */
export function useApi<T>(path: string | null, { timeoutMs = 0 }: { timeoutMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const latest = useRef(path);
  const requestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  latest.current = path;

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    activeController.current?.abort();
    if (!path) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const controller = timeoutMs > 0 ? new AbortController() : null;
    activeController.current = controller;
    let timedOut = false;
    const timer = controller ? window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs) : null;
    try {
      const result = await (controller ? api.get<T>(path, { signal: controller.signal }) : api.get<T>(path));
      if (latest.current === path && requestId.current === id) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (latest.current === path && requestId.current === id) {
        setError(timedOut ? 'The request took too long. Check your connection and select Retry.' : (e as Error).message);
      }
    } finally {
      if (timer !== null) window.clearTimeout(timer);
      if (latest.current === path && requestId.current === id) setLoading(false);
    }
  }, [path, timeoutMs]);

  useEffect(() => {
    setData(null);
    reload();
    return () => { requestId.current += 1; activeController.current?.abort(); };
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/**
 * Wrap an async action with busy and error state so buttons can be disabled while it runs.
 * `run` resolves to the action's result, or undefined when it failed (the error is in `error`).
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, run };
}
