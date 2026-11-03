import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { ClaimDrawer } from './ClaimDrawer';
import { api } from '../../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockAllowed;
const mockSetData = jest.fn();
const mockClaim = {
  id: 43, staff_name: 'Test Provider', category_name: 'Services', period_label: 'October 2026',
  amount: 40000, amount_paid: 0, currency: 'TZS', route_code: 'A', status: 'PENDING_CENTRAL_REVIEW',
  central_reviewer_id: 9, central_reviewer_name: 'Selected Reviewer', central_reviewed_at: null,
  payment_status: 'NOT_STARTED', payment_actions: [], exception_reason: null,
  workflow_version: 2, work_type: 'SERVICES', payments: [], proofs: [], audit: [], components: [],
  calculation_snapshot: null, budget_line: null, payor_name: 'FHI360', executor_name: 'FHI360',
  origin_channel: 'FACILITY', work_log_id: 19, batch_reference: null, verified_at: null, approved_at: null,
  created_at: '2026-10-01T00:00:00Z', declared_units: null, budget_line_id: null,
};
jest.mock('../../AuthContext', () => ({ useAuth: () => ({ hasRole: (...roles) => roles.includes('FHI360_FINANCE') }) }));
jest.mock('../../api', () => ({ api: { post: jest.fn() } }));
jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  useApi: () => ({ data: { ...mockClaim, available_actions: mockAllowed ? ['central_approve'] : [] }, error: null, loading: false, setData: mockSetData }),
}));
jest.mock('../../pages/PrintWorkLog', () => {
  const React = require('react');
  return {
    PrintWorkLog: ({ onReady }) => {
      React.useEffect(() => { onReady(); }, [onReady]);
      return <article>Monthly print preview</article>;
    },
  };
});

let container, root;
beforeEach(() => {
  mockAllowed = true;
  jest.clearAllMocks();
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('selected reviewer confirms the print preview before approving the exact amount', async () => {
  api.post.mockResolvedValue({ ...mockClaim, status: 'READY' });
  await act(async () => root.render(<ClaimDrawer claimId={43} onClose={() => {}} />));
  expect(container.textContent).toContain('Selected Reviewer');
  expect(container.textContent).toContain('Monthly print preview');
  const approve = [...container.querySelectorAll('button')].find(button => button.textContent === 'Approve Services for payment');
  expect(approve.disabled).toBe(true);
  act(() => Simulate.change(container.querySelector('input[type="checkbox"]'), { target: { checked: true } }));
  await act(async () => Simulate.click(approve));
  expect(api.post).toHaveBeenCalledWith('/claims/43/actions/central_approve', { review_confirmed: true, expected_amount: 40000 });
});

test('other Finance users see the assignment but no approval control', async () => {
  mockAllowed = false;
  await act(async () => root.render(<ClaimDrawer claimId={43} onClose={() => {}} />));
  expect(container.textContent).toContain('Selected Reviewer');
  expect(container.textContent).toContain('Payment recording is blocked');
  expect(container.textContent).not.toContain('Approve Services for payment');
  expect(container.textContent).not.toContain('Monthly print preview');
});

test('approval failure remains visible without reporting success', async () => {
  api.post.mockRejectedValue(new Error('Assignment changed. Refresh.'));
  await act(async () => root.render(<ClaimDrawer claimId={43} onClose={() => {}} />));
  act(() => Simulate.change(container.querySelector('input[type="checkbox"]'), { target: { checked: true } }));
  const approve = [...container.querySelectorAll('button')].find(button => button.textContent === 'Approve Services for payment');
  await act(async () => Simulate.click(approve));
  expect(container.textContent).toContain('Assignment changed. Refresh.');
  expect(mockSetData).not.toHaveBeenCalled();
});
