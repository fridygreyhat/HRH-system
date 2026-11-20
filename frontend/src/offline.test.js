import { api, setToken } from './api';
import { saveEntry, submitLog, syncOutbox } from './offline';
import { clearOffline, outbox, pendingItems, recall, remember } from './offlineStore';

const me = { id: 7, roles: ['PROVIDER'], staff: { id: 70 } };
const log = (entries = []) => ({ id: 15, staff: { id: 70 }, status: 'DRAFT', entries, totals: { days: entries.length, hours: 0, measures: {} } });
const reply = (status, body) => Promise.resolve({
  ok: status < 300, status, statusText: '', headers: { get: () => 'application/json' }, json: () => Promise.resolve(body),
});
const ok = (body) => reply(200, body);
const refused = (detail) => reply(422, { detail });
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

beforeEach(() => {
  localStorage.clear();
  setToken('token-7');
  remember('/auth/me', me);
  global.fetch = jest.fn();
});

test('a day saved without internet is kept on the phone and shown as waiting', async () => {
  fetch.mockImplementation(offline);
  const result = await saveEntry(log(), '2026-11-20', { activity_key: 'daily_attendance', hours_worked: 7.5, measures: {} });
  expect(result.queued).toBe(true);
  expect(result.log.entries).toEqual([expect.objectContaining({ entry_date: '2026-11-20', hours_worked: 7.5, pending: true })]);
  expect(result.log.totals).toEqual(expect.objectContaining({ days: 1, hours: 7.5 }));
  // Saving the same day again replaces the waiting copy rather than adding a second one.
  await saveEntry(log(), '2026-11-20', { activity_key: 'daily_attendance', hours_worked: 8, measures: {} });
  expect(pendingItems()).toHaveLength(1);
  expect(pendingItems()[0].body.hours_worked).toBe(8);
});

test('the timesheet opens offline from the copy kept on the phone, with the waiting days', async () => {
  fetch.mockImplementationOnce(() => ok(log([{ entry_date: '2026-11-19', hours_worked: 6, measures: {} }])));
  await api.get('/worklogs/15');
  fetch.mockImplementation(offline);
  await saveEntry(recall('/worklogs/15'), '2026-11-20', { activity_key: 'daily_attendance', hours_worked: 8, measures: {} });
  const shown = await api.get('/worklogs/15');
  expect(shown.entries.map((e) => [e.entry_date, e.hours_worked, !!e.pending])).toEqual([['2026-11-19', 6, false], ['2026-11-20', 8, true]]);
  expect(shown.totals.hours).toBe(14);
  expect(await api.get('/auth/me')).toEqual(me); // still signed in without internet
});

test('back online, the days are sent in order and then the submission', async () => {
  fetch.mockImplementation(offline);
  await saveEntry(log(), '2026-11-19', { activity_key: 'daily_attendance', hours_worked: 6, measures: {} });
  await saveEntry(log(), '2026-11-20', { activity_key: 'daily_attendance', hours_worked: 8, measures: {} });
  expect((await submitLog(log(), { attest: true })).queued).toBe(true);
  fetch.mockReset();
  fetch.mockImplementation(() => ok(log()));
  expect(await syncOutbox()).toBe(3);
  expect(fetch.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
    'PUT /api/worklogs/15/entries/2026-11-19', 'PUT /api/worklogs/15/entries/2026-11-20', 'POST /api/worklogs/15/actions/submit',
  ]);
  expect(outbox()).toEqual([]);
});

test('a day the server refuses is shown with its reason, and the submission waits for it to be corrected', async () => {
  fetch.mockImplementation(offline);
  await saveEntry(log(), '2026-11-20', { activity_key: 'daily_attendance', hours_worked: 8, measures: {} });
  await submitLog(log(), { attest: true });
  fetch.mockReset();
  fetch.mockImplementation((url) => (url.includes('/entries/') ? refused('Weekday hours may not exceed 40') : ok(log())));
  expect(await syncOutbox()).toBe(0);
  const [day, submission] = outbox();
  expect(day.error).toBe('Weekday hours may not exceed 40');
  expect(submission.error).toMatch(/a day on this timesheet was not accepted/);
  expect(fetch).toHaveBeenCalledTimes(1); // the submission was not sent
});

test('still offline: nothing is lost and it is tried again later', async () => {
  fetch.mockImplementation(offline);
  await saveEntry(log(), '2026-11-20', { activity_key: 'daily_attendance', hours_worked: 8, measures: {} });
  expect(await syncOutbox()).toBe(0);
  expect(pendingItems()).toHaveLength(1);
  expect(outbox()[0].error).toBeUndefined();
});

test("someone else's timesheet (a reviewer's view) is never kept, and sign-out or another person's sign-in clears the phone", async () => {
  remember('/worklogs/99', { id: 99, staff: { id: 1234 }, entries: [] });
  expect(recall('/worklogs/99')).toBeUndefined();
  remember('/worklogs/15', log());
  expect(recall('/worklogs/15')).toBeDefined();
  remember('/auth/me', { id: 8, roles: ['PROVIDER'], staff: { id: 80 } });
  expect(recall('/worklogs/15')).toBeUndefined();
  remember('/worklogs/15', log());
  clearOffline();
  expect(recall('/worklogs/15')).toBeUndefined();
  expect(recall('/auth/me')).toBeUndefined();
});

test('a refused save (not a lost connection) is reported at once, not kept', async () => {
  fetch.mockImplementation(() => refused('A Payroll day records the hours worked only.'));
  await expect(saveEntry(log(), '2026-11-20', { activity_key: 'x', hours_worked: 8, measures: {} })).rejects.toThrow('hours worked only');
  expect(outbox()).toEqual([]);
});
