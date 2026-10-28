import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Claims } from './Claims';
import { CreateClaim } from '../components/claims/CreateClaim';
import { useApi } from '../hooks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockRoles = [];
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ hasRole: (...wanted) => wanted.some(role => mockRoles.includes(role)) }),
}));
jest.mock('../hooks', () => ({
  useApi: jest.fn(() => ({ data: [], error: null, loading: false, reload: jest.fn() })),
  useAction: jest.fn(() => ({ error: null, busy: false, run: jest.fn() })),
}));
jest.mock('../components/claims/ClaimDrawer', () => ({
  ClaimDrawer: () => null, ComponentsTable: () => null,
}));

beforeEach(() => { mockRoles = ['REGIONAL_FINANCE', 'FHI360_FINANCE']; useApi.mockClear(); window.location.hash = ''; });

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
