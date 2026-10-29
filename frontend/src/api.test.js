import { api, getToken, onUnauthorized, setToken } from './api';

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
