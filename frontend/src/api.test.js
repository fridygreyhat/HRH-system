import { READ_TIMEOUT_MS, RETRY_DELAY_MS, api, getToken, onUnauthorized, setToken } from './api';

afterEach(() => {
  jest.restoreAllMocks();
  onUnauthorized(null);
  setToken(null);
  delete global.fetch;
});

test('a session remains usable in memory when browser storage is blocked', async () => {
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({ id: 1 }),
  });
  setToken('synthetic-session');
  expect(getToken()).toBe('synthetic-session');
  await api.get('/auth/me');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-session');
  setToken(null);
  expect(getToken()).toBeNull();
});

test.each([
  ['attachment; filename="100% complete.csv"', '100% complete.csv'],
  ['attachment; filename="claim; September.csv"', 'claim; September.csv'],
  ['attachment; filename="fallback.csv"; filename*=UTF-8\'\'malipo%20Septemba.csv', 'malipo Septemba.csv'],
  ['attachment; filename*=UTF-8\'\'invalid%name.csv', 'invalid%name.csv'],
])('download filenames are handled without losing the download: %s', async (header, expected) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => header },
    blob: async () => new Blob(['test']),
  });
  expect((await api.blob('/export')).filename).toBe(expected);
});

test('an expired authenticated session clears credentials and notifies the app', async () => {
  const expired = jest.fn();
  onUnauthorized(expired);
  setToken('synthetic-expired-session');
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
  await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 401 });
  expect(getToken()).toBeNull();
  expect(expired).toHaveBeenCalledTimes(1);
});

test('a late unauthorized response from an old session cannot sign out a newer session', async () => {
  const expired = jest.fn();
  onUnauthorized(expired);
  let respond;
  global.fetch = jest.fn().mockReturnValue(new Promise((resolve) => { respond = resolve; }));
  setToken('synthetic-old-session');
  const request = api.get('/auth/me');
  setToken('synthetic-new-session');
  respond({ ok: false, status: 401 });
  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(getToken()).toBe('synthetic-new-session');
  expect(expired).not.toHaveBeenCalled();
});

test('API reads, downloads and sign-in bypass the browser response cache', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    json: async () => ({}), blob: async () => new Blob(['test']),
  });
  await api.get('/finance/monthly');
  await api.blob('/finance/export');
  await api.login('synthetic-user', 'synthetic-password');
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [, options] of fetch.mock.calls) {
    expect(options.cache).toBe('no-store');
  }
});

const gatewayTimeout = { ok: false, status: 504, statusText: 'Gateway Timeout', headers: { get: () => 'text/html' }, json: async () => { throw new Error('html'); } };
const okJson = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });

test('a read that hits a gateway timeout is tried once more and succeeds', async () => {
  RETRY_DELAY_MS.value = 0;
  global.fetch = jest.fn().mockResolvedValueOnce(gatewayTimeout).mockResolvedValueOnce(okJson([{ id: 1 }]));
  await expect(api.get('/admin/cadres')).resolves.toEqual([{ id: 1 }]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('a read that keeps timing out explains it plainly after one retry', async () => {
  RETRY_DELAY_MS.value = 0;
  global.fetch = jest.fn().mockResolvedValue(gatewayTimeout);
  await expect(api.get('/admin/cadres')).rejects.toThrow('The server did not answer in time');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('a save is never retried, so it cannot be applied twice', async () => {
  RETRY_DELAY_MS.value = 0;
  global.fetch = jest.fn().mockResolvedValue(gatewayTimeout);
  await expect(api.post('/worklogs', {})).rejects.toThrow('The server did not answer in time');
  expect(fetch).toHaveBeenCalledTimes(1);
});

// A fetch that never answers until it is aborted, as when a tunnel drops a request.
const stalled = (url, options) => new Promise((_, reject) => {
  options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
});

test('a read that stalls is abandoned after the time limit and tried once more', async () => {
  RETRY_DELAY_MS.value = 0;
  READ_TIMEOUT_MS.value = 20;
  global.fetch = jest.fn().mockImplementationOnce(stalled).mockResolvedValueOnce(okJson([{ id: 2 }]));
  await expect(api.get('/admin/cadres')).resolves.toEqual([{ id: 2 }]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('a read that stalls twice says the server cannot be reached', async () => {
  RETRY_DELAY_MS.value = 0;
  READ_TIMEOUT_MS.value = 20;
  global.fetch = jest.fn().mockImplementation(stalled);
  await expect(api.get('/admin/cadres')).rejects.toThrow('Cannot reach the server');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('a save has no time limit, so a slow save is never abandoned or sent twice', async () => {
  READ_TIMEOUT_MS.value = 20;
  let answer;
  global.fetch = jest.fn().mockImplementation((url, options) => new Promise((resolve) => {
    expect(options.signal).toBeUndefined();
    answer = () => resolve(okJson({ saved: true }));
  }));
  const saving = api.post('/worklogs', {});
  await new Promise((resolve) => setTimeout(resolve, 60));
  answer();
  await expect(saving).resolves.toEqual({ saved: true });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('a page that cancels its own read is not retried', async () => {
  RETRY_DELAY_MS.value = 0;
  READ_TIMEOUT_MS.value = 10000;
  global.fetch = jest.fn().mockImplementation(stalled);
  const page = new AbortController();
  const reading = api.get('/admin/cadres', { signal: page.signal });
  page.abort();
  await expect(reading).rejects.toThrow('Cannot reach the server');
  expect(fetch).toHaveBeenCalledTimes(1);
});
