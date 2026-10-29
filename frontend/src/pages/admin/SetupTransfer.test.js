import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { SetupTransfer } from './SetupTransfer';
import { api, saveBlob } from '../../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../api', () => ({
  ApiError: class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } },
  api: { blob: jest.fn(), post: jest.fn() },
  saveBlob: jest.fn(),
}));

function mountTransfer() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<SetupTransfer />));
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

async function clickAndFlush(button) {
  await act(async () => {
    Simulate.click(button);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function uploadDocument(container) {
  const contents = JSON.stringify({
    version: 1,
    records: [{
      id: 'cadre:chw', kind: 'user_setup', label: 'Community health worker',
      data: {
        roles: ['REGIONAL_FINANCE'], scopes: [{ region_id: 7, name: 'Mara' }],
        placements: [{ facility: 'Mara Dispensary' }], period_status: 'OPEN', rates: [{ activity: 'Home visits', amount: 4200 }],
      },
    }],
  });
  const file = new File([contents], 'preview-setup.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => contents });
  await act(async () => {
    Simulate.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.post.mockResolvedValue({
    review_token: 'review-123',
    items: [{ id: 'cadre:chw', kind: 'cadre', label: 'Community health worker', state: 'MISSING', message: 'Will be created.' }],
    warnings: [],
  });
});

test('reviews imported setup, requires explicit selection and sends confirmation on apply', async () => {
  const { container, unmount } = mountTransfer();
  try {
    await uploadDocument(container);
    await clickAndFlush(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Review setup')));
    expect(api.post).toHaveBeenCalledWith('/admin/setup-transfer/review', {
      document: expect.objectContaining({ version: 1, records: expect.any(Array) }),
    });
    const apply = () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent.startsWith('Apply '));
    expect(apply().disabled).toBe(true);

    const inspect = Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Inspect configuration details'));
    await clickAndFlush(inspect);
    const recordData = container.querySelector('[aria-label="Community health worker configuration data"]');
    expect(recordData.textContent).toContain('REGIONAL_FINANCE');
    expect(recordData.textContent).toContain('Mara');
    expect(recordData.textContent).toContain('OPEN');
    expect(recordData.textContent).toContain('4200');
    const checkbox = container.querySelector('input[type="checkbox"][aria-label="Select Community health worker"]');
    expect(checkbox.disabled).toBe(false);
    act(() => Simulate.change(checkbox, { target: { checked: true } }));
    expect(apply().disabled).toBe(true);
    expect(container.textContent).toContain('Enter a reason for this transfer using at least 3 characters.');
    expect(container.textContent).toContain('Type APPLY MISSING SETUP exactly in the confirmation field above.');
    expect(apply().getAttribute('aria-describedby')).toBe('setup-apply-requirements');
    const fields = container.querySelectorAll('textarea, input:not([type="file"]):not([type="checkbox"])');
    expect(fields[0].maxLength).toBe(1000);
    act(() => Simulate.change(fields[0], { target: { value: 'Approved Preview configuration' } }));
    expect(apply().disabled).toBe(true);
    expect(container.textContent).not.toContain('Enter a reason for this transfer using at least 3 characters.');
    act(() => Simulate.change(fields[1], { target: { value: 'apply missing setup' } }));
    expect(apply().disabled).toBe(true);
    expect(container.textContent).toContain('Type APPLY MISSING SETUP exactly in the confirmation field above.');
    act(() => Simulate.change(fields[1], { target: { value: 'APPLY MISSING SETUP' } }));
    expect(apply().disabled).toBe(false);
    expect(container.textContent).toContain('Ready to apply 1 selected item. No changes have been applied yet.');

    api.post.mockResolvedValueOnce({
      applied: 1, skipped: 0,
      items: [{ id: 'cadre:chw', kind: 'cadre', label: 'Community health worker', state: 'MISSING', message: 'Applied.' }],
    });
    await clickAndFlush(apply());
    expect(api.post).toHaveBeenLastCalledWith('/admin/setup-transfer/apply', {
      document: expect.objectContaining({ version: 1 }),
      selected_ids: ['cadre:chw'],
      review_token: 'review-123',
      reason: 'Approved Preview configuration',
      confirmation: 'APPLY MISSING SETUP',
    });
    expect(container.textContent).toContain('1 setup item applied; 0 skipped.');
  } finally {
    unmount();
  }
});

test('a stale review is not retried and requires a fresh review', async () => {
  const { container, unmount } = mountTransfer();
  try {
    await uploadDocument(container);
    await clickAndFlush(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Review setup')));
    await clickAndFlush(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.includes('Inspect configuration details')));
    act(() => Simulate.change(container.querySelector('input[type="checkbox"][aria-label="Select Community health worker"]'), { target: { checked: true } }));
    const fields = container.querySelectorAll('textarea, input:not([type="file"]):not([type="checkbox"])');
    act(() => Simulate.change(fields[0], { target: { value: 'Approved Preview configuration' } }));
    act(() => Simulate.change(fields[1], { target: { value: 'APPLY MISSING SETUP' } }));
    api.post.mockRejectedValueOnce(Object.assign(new Error('Review token is stale'), { status: 409 }));
    await clickAndFlush(Array.from(container.querySelectorAll('button')).find((button) => button.textContent.startsWith('Apply ')));
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Review this document again before selecting and applying items.');
    expect(container.textContent).toContain('This review is no longer current.');
  } finally {
    unmount();
  }
});

test('rejects oversized input locally before calling review', async () => {
  const { container, unmount } = mountTransfer();
  try {
    const tooLarge = new File([new Uint8Array(1024 * 1024 + 1)], 'large.json', { type: 'application/json' });
    act(() => Simulate.change(container.querySelector('input[type="file"]'), { target: { files: [tooLarge] } }));
    expect(container.textContent).toContain('larger than 1 MiB');
    expect(api.post).not.toHaveBeenCalled();
    expect(saveBlob).not.toHaveBeenCalled();
  } finally {
    unmount();
  }
});
