import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ClaimDrawer } from './ClaimDrawer';
import { api } from '../../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockClaim = {
  id: 43, staff_name: 'Asha Mollel', category_name: 'Community outreach', period_label: 'January 2025',
  amount: 48000, amount_paid: 0, currency: 'TZS', route_code: 'C', status: 'PENDING_COMMUNITY_VERIFICATION',
  payment_status: 'NOT_STARTED', available_actions: ['verify_community', 'send_back'], payment_actions: [],
  exception_reason: null, workflow_version: 2, work_type: 'COMMUNITY', payments: [], proofs: [], audit: [],
  components: [], calculation_snapshot: null, budget_line: null, payor_name: 'Kijiji CSO', executor_name: null,
  origin_channel: 'COMMUNITY', work_log_id: null, batch_reference: null, verified_at: null, approved_at: null,
  created_at: '2025-01-01T00:00:00Z', declared_units: { visits: 12 }, evidence_text: 'Community clinic support', description: 'Community clinic support',
  budget_line_id: 3, category_id: 5, period_id: 7, staff_id: 8, payor_org_id: 4, executor_org_id: null,
  created_by: 8, updated_at: '2025-01-01T00:00:00Z',
};
let mockRole = 'COMMUNITY_VERIFIER';

jest.mock('../../AuthContext', () => ({ useAuth: () => ({ hasRole: (...roles) => roles.includes(mockRole) }) }));
jest.mock('../../api', () => ({ api: { get: jest.fn(), post: jest.fn(), blob: jest.fn() }, openBlob: jest.fn(), saveBlob: jest.fn() }));
jest.mock('../../hooks', () => ({
  useApi: () => ({ data: mockClaim, error: null, loading: false, setData: jest.fn() }),
  useAction: () => ({ busy: false, error: null, run: jest.fn() }),
}));

test('community verifier sees only server-authorized verify and send-back actions', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ClaimDrawer claimId={43} onClose={() => {}} />));
  try {
    expect(container.textContent).toContain('Verify community service');
    expect(container.textContent).toContain('Send back for validation');
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent.trim() === 'Approve')).toBe(false);
    expect(container.textContent).toContain('Description');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('estimate warning uses budget committed plus spent and does not alter claim actions', () => {
  mockRole = 'FHI360_FINANCE';
  mockClaim.budget_line = { id: 3, code: 'CSO-3', name: 'Outreach', estimated_amount: 100, committed_amount: 65, spent_amount: 40, allocated_amount: 200 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ClaimDrawer claimId={43} onClose={() => {}} />));
  try {
    expect(container.textContent).toContain('Soft estimate reached for CSO-3');
    expect(container.textContent).toContain('TZS');
    expect(container.textContent).toContain('Verify community service');
    expect(container.textContent).toContain('Send back for validation');
  } finally {
    mockClaim.budget_line = null;
    mockRole = 'COMMUNITY_VERIFIER';
    act(() => root.unmount());
    container.remove();
  }
});

test('claim viewers without budget visibility do not see embedded estimate details', () => {
  mockRole = 'PROVIDER';
  mockClaim.budget_line = { id: 3, code: 'CSO-3', name: 'Outreach', estimated_amount: 0, committed_amount: 4, spent_amount: 1, allocated_amount: 10 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ClaimDrawer claimId={43} onClose={() => {}} />));
  try {
    expect(container.textContent).not.toContain('Soft estimate reached');
  } finally {
    mockClaim.budget_line = null;
    mockRole = 'COMMUNITY_VERIFIER';
    act(() => root.unmount());
    container.remove();
  }
});

test('provider sees server-authorized submit and cancellation actions for a direct claim', async () => {
  mockRole = 'PROVIDER';
  api.post.mockResolvedValue(mockClaim);
  mockClaim.status = 'DRAFT';
  mockClaim.available_actions = ['submit', 'cancel'];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ClaimDrawer claimId={43} onClose={() => {}} />));
  try {
    const submit = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Submit for approval');
    expect(submit).toBeTruthy();
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent === 'Cancel claim')).toBe(true);
    await act(async () => submit.click());
    const confirm = Array.from(container.querySelectorAll('button')).filter(button => button.textContent === 'Submit for approval').pop();
    await act(async () => confirm.click());
    expect(api.post).toHaveBeenCalledWith('/claims/43/actions/submit', { comment: null });
  } finally {
    mockClaim.status = 'PENDING_COMMUNITY_VERIFICATION';
    mockClaim.available_actions = ['verify_community', 'send_back'];
    mockRole = 'COMMUNITY_VERIFIER';
    act(() => root.unmount());
    container.remove();
  }
});
