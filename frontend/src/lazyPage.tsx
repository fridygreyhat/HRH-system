import React, { lazy } from 'react';
import { Alert, Loading, pageLang } from './components/ui';

/** Waits used between attempts; tests shorten them. */
export const CHUNK_RETRY_MS = { value: 1500 };
/** How the page reloads to fetch a newly published version; tests replace it. */
export const PAGE_RELOAD = { run: () => window.location.reload() };
const RELOADED_KEY = 'hrh_chunk_reload_at';

function reloadedRecently(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(RELOADED_KEY) || 0) < 60_000;
  } catch {
    return true; // without storage, never risk a reload loop
  }
}

/**
 * Download a screen's code, trying once more over a dropped connection. A file that is still missing usually means
 * a new version was published while the page was open (old files are replaced), so the page reloads once to get it.
 */
export async function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, CHUNK_RETRY_MS.value));
    try {
      return await load();
    } catch (error) {
      if (!reloadedRecently()) {
        try {
          sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
        } catch {
          throw error;
        }
        PAGE_RELOAD.run();
        return new Promise<T>(() => undefined); // the page is reloading
      }
      throw error;
    }
  }
}

/** A screen whose code is downloaded the first time it is opened, keeping the sign-in download small. */
export function lazyPage<P>(load: () => Promise<React.ComponentType<P>>) {
  return lazy(() => loadChunk(load).then((component) => ({ default: component })));
}

interface BoundaryProps {
  /** Changing it (another page) clears an earlier failure. */
  resetKey: string;
  children: React.ReactNode;
}

/** Shows a short message instead of a blank screen when a page cannot be downloaded or shown. */
export class PageBoundary extends React.Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return <React.Suspense fallback={<Loading />}>{this.props.children}</React.Suspense>;
    const sw = pageLang() === 'sw';
    return (
      <div className="stack">
        <Alert>
          {sw
            ? 'Ukurasa huu haukuweza kufunguliwa. Angalia mtandao wako kisha ujaribu tena.'
            : 'This page could not be opened. Check your connection and try again.'}
        </Alert>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => PAGE_RELOAD.run()}>
            {sw ? 'Jaribu tena' : 'Try again'}
          </button>
        </div>
      </div>
    );
  }
}
