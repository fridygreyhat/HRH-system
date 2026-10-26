import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { api } from './api';
import { useApi } from './hooks';

jest.mock('./api', () => ({ api: { get: jest.fn() } }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let container;
let current;
function Probe({ path }) {
  current = useApi(path);
  return <span>{current.data?.name || ''}</span>;
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  api.get.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test('a slower earlier refresh cannot replace the latest result for the same record', async () => {
  const older = deferred();
  const newer = deferred();
  api.get.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  act(() => root.render(<Probe path="/record/1" />));
  let refresh;
  act(() => { refresh = current.reload(); });
  await act(async () => { newer.resolve({ name: 'latest' }); await refresh; });
  expect(container.textContent).toBe('latest');
  await act(async () => { older.resolve({ name: 'outdated' }); await older.promise; });
  expect(container.textContent).toBe('latest');
  expect(current.loading).toBe(false);
});

test('changing or disabling the request clears previous record data and errors', async () => {
  api.get.mockResolvedValueOnce({ name: 'first record' });
  await act(async () => root.render(<Probe path="/record/1" />));
  expect(container.textContent).toBe('first record');
  const next = deferred();
  api.get.mockReturnValueOnce(next.promise);
  act(() => root.render(<Probe path="/record/2" />));
  expect(current.data).toBeNull();
  expect(current.loading).toBe(true);
  act(() => root.render(<Probe path={null} />));
  expect(current.data).toBeNull();
  expect(current.error).toBeNull();
  expect(current.loading).toBe(false);
  await act(async () => { next.resolve({ name: 'must stay hidden' }); await next.promise; });
  expect(current.data).toBeNull();
});

test('an older failed request cannot overwrite a newer successful refresh', async () => {
  const older = deferred();
  api.get.mockReturnValueOnce(older.promise).mockResolvedValueOnce({ name: 'latest' });
  act(() => root.render(<Probe path="/record/1" />));
  await act(async () => current.reload());
  await act(async () => { older.reject(new Error('old request failed')); await older.promise.catch(() => {}); });
  expect(current.error).toBeNull();
  expect(current.data.name).toBe('latest');
});
