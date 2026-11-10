const API_URL = process.env.REACT_APP_API_URL || '/api';
const TOKEN_KEY = 'hrh_token';
let memoryToken: string | null = null;
let memoryOnly = false;

export const getToken = (): string | null => {
  if (memoryOnly) return memoryToken;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return memoryToken;
  }
};

export const setToken = (token: string | null): void => {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    memoryOnly = false;
  } catch {
    // Blocked storage must not prevent sign-in; this session ends on reload.
    memoryOnly = true;
  }
};

/** Error carrying the HTTP status and FastAPI's `detail` message. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let unauthorizedHandler: (() => void) | null = null;
/** Called once when an authenticated request comes back 401 (expired or revoked token). */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

interface ValidationItem {
  loc?: (string | number)[];
  msg?: string;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return (detail as ValidationItem[])
        .map((d) => {
          const where = (d.loc || []).filter((p) => p !== 'body').join('.');
          return `${where ? `${where}: ` : ''}${d.msg || 'invalid'}`;
        })
        .join('; ');
    }
  }
  return fallback;
}

type Payload = unknown | FormData | URLSearchParams | undefined;

type SendOptions = { signal?: AbortSignal; /** Give up when no answer has started by then. */ timeoutMs?: number };

async function send(method: string, path: string, body?: Payload, options?: SendOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let data: BodyInit | undefined;
  if (body instanceof FormData || body instanceof URLSearchParams) {
    data = body; // the browser sets the multipart boundary / form encoding itself
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    data = JSON.stringify(body);
  }
  const caller = options?.signal;
  // Only the wait for the answer to start is limited: a large list or file may then take as long as it needs.
  const limit = options?.timeoutMs ? new AbortController() : null;
  if (limit && caller) {
    if (caller.aborted) limit.abort();
    else caller.addEventListener('abort', () => limit.abort(), { once: true });
  }
  const timer = limit ? setTimeout(() => limit.abort(), options?.timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: data, cache: 'no-store', signal: limit ? limit.signal : caller });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 && token) {
    // A response started before a fresh sign-in cannot revoke the new session.
    if (getToken() === token) {
      setToken(null);
      unauthorizedHandler?.();
    }
    throw new ApiError(401, 'Your session has expired. Please sign in again.');
  }
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    const gateway = GATEWAY_STATUSES.includes(res.status) && !parsed;
    throw new ApiError(res.status, gateway
      ? 'The server did not answer in time. Check your connection and try again.'
      : errorMessage(parsed, `${res.status} ${res.statusText}`));
  }
  return res;
}

/** Statuses a proxy or tunnel returns when it loses the app for a moment, before the app has seen the request. */
const GATEWAY_STATUSES = [502, 503, 504];
export const RETRY_DELAY_MS = { value: 1500 };
/** A read whose answer has not started by then is abandoned and tried again. A port-forwarding tunnel sometimes
 *  drops a request without answering; a save is never abandoned, as the server may already have applied it. */
export const READ_TIMEOUT_MS = { value: 20000 };

/** A read that hits a dropped connection, a stalled tunnel or a gateway timeout is tried once more; saves never are. */
async function sendRetrying(method: string, path: string, body?: Payload, options?: { signal?: AbortSignal }): Promise<Response> {
  const attempt = method === 'GET' ? { ...options, timeoutMs: READ_TIMEOUT_MS.value } : options;
  try {
    return await send(method, path, body, attempt);
  } catch (e) {
    const retryable = method === 'GET' && e instanceof ApiError && (e.status === 0 || GATEWAY_STATUSES.includes(e.status));
    if (!retryable || options?.signal?.aborted) throw e;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS.value));
    if (options?.signal?.aborted) throw e;
    return send(method, path, body, attempt);
  }
}

async function json<T>(method: string, path: string, body?: Payload, options?: { signal?: AbortSignal }): Promise<T> {
  const res = await sendRetrying(method, path, body, options);
  if (res.status === 204) return undefined as unknown as T;
  const type = res.headers.get('content-type') || '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export interface BlobResult {
  blob: Blob;
  filename: string;
  /** Response headers, for downloads the server records (X-Download-Id). */
  headers?: Headers;
}

function filenameFrom(res: Response, fallback: string): string {
  const disposition = res.headers.get('content-disposition') || '';
  // RFC 5987 filenames take precedence over their ASCII fallback.
  const extended = /(?:^|;)\s*filename\*\s*=\s*(?:UTF-8'[^']*')"?([^";]+)"?/i.exec(disposition);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      return extended[1]; // A malformed header must not discard a valid file.
    }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i.exec(disposition);
  return plain ? (plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2].trim()) || fallback : fallback;
}

/** Build a query string from defined, non-empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== false) search.set(k, String(v));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: <T,>(path: string, options?: { signal?: AbortSignal }) => json<T>('GET', path, undefined, options),
  post: <T,>(path: string, body: unknown = {}) => json<T>('POST', path, body),
  put: <T,>(path: string, body: unknown) => json<T>('PUT', path, body),
  patch: <T,>(path: string, body: unknown) => json<T>('PATCH', path, body),
  del: <T,>(path: string) => json<T>('DELETE', path),
  /** Multipart upload; do not set Content-Type so the browser adds the boundary. */
  upload: <T,>(path: string, form: FormData) => json<T>('POST', path, form),
  /** Authenticated file download (never a public link). */
  blob: async (path: string, method: 'GET' | 'POST' = 'GET', fallbackName = 'download'): Promise<BlobResult> => {
    const res = await send(method, path, method === 'POST' ? {} : undefined);
    return { blob: await res.blob(), filename: filenameFrom(res, fallbackName), headers: res.headers };
  },
  login: (username: string, password: string) =>
    json<{ access_token: string }>('POST', '/auth/login', new URLSearchParams({ username, password })),
};

/** Save a downloaded blob with its server-provided filename. */
export function saveBlob({ blob, filename }: BlobResult): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Open a downloaded blob (e.g. a proof PDF/image) in a new tab via an object URL. */
export function openBlob({ blob, filename }: BlobResult): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.title = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
