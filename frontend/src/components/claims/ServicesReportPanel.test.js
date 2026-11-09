import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ServicesReportPanel } from './ServicesReportPanel';
import * as apiModule from '../../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../../AuthContext', () => ({ useAuth: () => ({ lang: 'en' }) }));
const mockReload = jest.fn();
jest.mock('../../hooks', () => ({
  useApi: () => ({ data: [], error: null, loading: false, reload: mockReload }),
  useAction: () => ({ busy: false, error: null, setError: jest.fn(), run: async (fn) => fn() }),
}));

test('after a download, Central Finance records the PRF for exactly that file', async () => {
  const headers = new Map([['x-download-id', '41']]);
  const blob = jest.spyOn(apiModule.api, 'blob').mockResolvedValue({ blob: new Blob(), filename: 's.csv', headers: { get: (k) => headers.get(k) } });
  const save = jest.spyOn(apiModule, 'saveBlob').mockImplementation(() => {});
  const get = jest.spyOn(apiModule.api, 'get').mockResolvedValue({ id: 41, awaiting_review: 0, format: 'csv', row_count: 3, claim_count: 2, amounts: { TZS: '750' }, downloaded_at: '2026-11-08T08:00:00Z', prf: null });
  const post = jest.spyOn(apiModule.api, 'post').mockResolvedValue({ id: 5, prf_number: 'PRF/1', prf_date: '2026-11-08', amounts: { TZS: '750' }, claim_count: 2, note: null, recorded_by: 'CF', recorded_at: '2026-11-08T08:01:00Z' });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ServicesReportPanel />));
  try {
    await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Download Services CSV').click());
    expect(blob).toHaveBeenCalledWith(expect.stringMatching(/format=csv$/), 'GET', expect.any(String));
    expect(get).toHaveBeenCalledWith('/finance/services-payment-report/downloads/41');
    expect(container.textContent).toContain('2 claims, 3 rows, total TZS 750');
    const input = container.querySelector('input[placeholder="PRF/2026/001"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ' PRF/1 ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(post).toHaveBeenCalledWith('/finance/services-payment-report/prf', expect.objectContaining({ download_id: 41, prf_number: 'PRF/1' }));
    expect(container.textContent).toContain('Recorded as PRF PRF/1.');
    expect(mockReload).toHaveBeenCalled();
  } finally {
    act(() => root.unmount()); container.remove();
    blob.mockRestore(); save.mockRestore(); get.mockRestore(); post.mockRestore();
  }
});
