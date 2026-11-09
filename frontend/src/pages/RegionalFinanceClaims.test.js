import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Claims } from './Claims';
import { CreateClaim } from '../components/claims/CreateClaim';
import { useApi } from '../hooks';
import * as apiModule from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockRoles = [];
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ hasRole: (...wanted) => wanted.some(role => mockRoles.includes(role)) }),
}));
jest.mock('../hooks', () => ({
  useApi: jest.fn(() => ({ data: [], error: null, loading: false, reload: jest.fn() })),
  useAction: jest.fn(() => ({ error: null, busy: false, run: jest.fn(), setError: jest.fn() })),
}));
jest.mock('../components/claims/ClaimDrawer', () => ({
  ClaimDrawer: () => null, ComponentsTable: () => null,
}));

beforeEach(() => {
  mockRoles = ['REGIONAL_FINANCE', 'FHI360_FINANCE'];
  useApi.mockClear();
  useApi.mockImplementation(() => ({ data: [], error: null, loading: false, reload: jest.fn() }));
  window.location.hash = '';
});

test('Central Finance downloads a month-specific Services report; CSO has no Services export', async () => {
  const download = jest.spyOn(apiModule.api, 'blob').mockResolvedValue({ blob: new Blob(), filename: 'services.csv' });
  const save = jest.spyOn(apiModule, 'saveBlob').mockImplementation(() => {});
  mockRoles = ['FHI360_FINANCE'];
  const { container, close } = render(<Claims />);
  try {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Download Services CSV');
    expect(button).toBeTruthy();
    await act(async () => button.click());
    expect(download).toHaveBeenCalledWith(expect.stringMatching(/^\/finance\/services-payment-report\/export\?month=\d{4}-\d{2}&format=csv$/),
      'GET', expect.any(String));
    expect(save).toHaveBeenCalled();
  } finally {
    close(); download.mockRestore(); save.mockRestore();
  }
  mockRoles = ['CSO_FINANCE'];
  const cso = render(<Claims />);
  try { expect(cso.container.textContent).not.toContain('Download Services CSV'); }
  finally { cso.close(); }
});

test('finance can page beyond the first claims without losing filters', () => {
  useApi.mockImplementation(path => ({
    data: path.startsWith('/claims?') ? Array.from({ length: 100 }, (_, i) => ({
      id: i + 1, staff_name: 'Provider', status: 'READY', payment_status: 'NOT_STARTED',
      amount: 40000, amount_paid: 0, currency: 'TZS',
    })) : [],
    error: null, loading: false, reload: jest.fn(),
  }));
  const { container, close } = render(<Claims />);
  try {
    act(() => [...container.querySelectorAll('button')].find(b => b.textContent === 'Next claims').click());
    expect(useApi).toHaveBeenCalledWith(expect.stringContaining('offset=100&limit=100'));
    expect(container.textContent).toContain('Page 2');
  } finally { close(); }
});

function render(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, close: () => { act(() => root.unmount()); container.remove(); } };
}

test('mixed Regional and Central Finance roles use routing/report links, not manual claim preparation', () => {
  const { container, close } = render(<Claims />);
  try {
    expect(container.textContent).toContain('Regional Finance workspace');
    expect(container.textContent).not.toContain('Prepare a claim');
    const report = [...container.querySelectorAll('button')].find(button => button.textContent === 'Monthly work report');
    act(() => report.click());
    expect(window.location.hash).toBe('#/finance-monthly');
    const routing = [...container.querySelectorAll('button')].find(button => button.textContent === 'Review Services routing');
    act(() => routing.click());
    expect(window.location.hash).toBe('#/routing-queue');
    expect(container.textContent).toContain('No claim category, funding source, budget or finance approval is required');
  } finally { close(); }
});

test('direct manual-form entry is guarded without requesting categories or eligible work logs', () => {
  const { container, close } = render(<CreateClaim onClose={() => {}} onCreated={() => {}} />);
  try {
    expect(document.body.textContent).toContain('Regional Finance workspace');
    expect(useApi).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Select an active claim category');
  } finally { close(); }
});

test('legacy claim preparation remains available to channel finance without a Regional Finance role', () => {
  mockRoles = ['CSO_FINANCE'];
  const { container, close } = render(<Claims />);
  try {
    expect(container.textContent).toContain('Prepare a claim');
    expect(container.textContent).not.toContain('Regional Finance workspace');
  } finally { close(); }
});
