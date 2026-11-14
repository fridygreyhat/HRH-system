import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { CHUNK_RETRY_MS, loadChunk, PAGE_RELOAD, PageBoundary } from './lazyPage';

const realReload = PAGE_RELOAD.run;
beforeEach(() => {
  CHUNK_RETRY_MS.value = 0;
  PAGE_RELOAD.run = jest.fn();
  sessionStorage.clear();
});
afterAll(() => {
  PAGE_RELOAD.run = realReload;
});

test('a screen that fails to download once is fetched again without reloading', async () => {
  const load = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('Screen');
  await expect(loadChunk(load)).resolves.toBe('Screen');
  expect(load).toHaveBeenCalledTimes(2);
  expect(PAGE_RELOAD.run).not.toHaveBeenCalled();
});

test('a screen still missing after a retry reloads the page once, then reports the failure', async () => {
  const missing = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));
  const first = loadChunk(missing);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(PAGE_RELOAD.run).toHaveBeenCalledTimes(1); // a newer version was published: fetch it
  // Straight after that reload, the same failure is shown instead of reloading again (no reload loop).
  await expect(loadChunk(missing)).rejects.toThrow('dynamically imported');
  expect(PAGE_RELOAD.run).toHaveBeenCalledTimes(1);
  expect(first).toBeInstanceOf(Promise);
});

test('a page that cannot be opened shows a message and a way to try again, and clears on another page', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const Broken = () => {
    throw new Error('chunk failed');
  };
  const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  act(() => root.render(<PageBoundary resetKey="claims"><Broken /></PageBoundary>));
  expect(container.textContent).toContain('This page could not be opened');
  act(() => container.querySelector('button').click());
  expect(PAGE_RELOAD.run).toHaveBeenCalledTimes(1);
  act(() => root.render(<PageBoundary resetKey="staff"><p>Staff registry</p></PageBoundary>));
  expect(container.textContent).toBe('Staff registry');
  quiet.mockRestore();
  act(() => root.unmount());
  container.remove();
});
