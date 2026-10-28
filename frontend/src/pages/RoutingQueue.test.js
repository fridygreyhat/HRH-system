import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { RoutingQueue } from './RoutingQueue';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockQueuePath = '';
const mockItem = {
  work_log_id: 92, claim_id: 120, workflow_version: 2, work_type: 'SERVICES', provider_name: 'Rehema Kweka',
  cadre_id: 3, cadre_code: 'HCP', cadre_name: 'Health care provider', facility_id: 2, facility_name: 'Mlimani Clinic',
  region_id: 8, region_name: 'Mara', period_label: 'May 2025', status: 'PENDING_FINANCE_REVIEW',
  next_action: 'REVIEW_AMOUNT', finance_review_required: true, amount: '173450', currency: 'TZS',
  eligible_payors: [], routing_exception: null,
};

jest.mock('../hooks', () => ({
  useApi: path => {
    if (path && path.startsWith('/finance/pending-routing')) mockQueuePath = path;
    return { data: path === '/finance/regions' ? [] : [mockItem], error: null, loading: false, reload: jest.fn() };
  },
}));
jest.mock('../components/worklogs/WorkLogDrawer', () => ({ WorkLogDrawer: ({ logId }) => <div role="dialog">Review work log #{logId}</div> }));

test('services queue preserves finance payment review and opens its work-log review', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<RoutingQueue />));
  try {
    act(() => Simulate.change(container.querySelector('select[aria-label="Filter by queue stage"]'), { target: { value: 'PENDING_FINANCE_REVIEW' } }));
    expect(mockQueuePath).toContain('stage=PENDING_FINANCE_REVIEW');
    expect(container.textContent).toContain('Amount review required');
    expect(container.textContent).toContain('TZS 173450');
    expect(container.textContent).toContain('Review amount');
    expect(container.textContent).toContain('Services routing queue');
    expect(container.textContent).toContain('Payroll has no pricing');
    expect(mockQueuePath).toContain('work_type=SERVICES');
    act(() => Simulate.click(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Review amount')));
    expect(container.textContent).toContain('Review work log #92');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('routing queue has no Payroll filter or Payroll review actions', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mockItem.work_type = 'PAYROLL';
  act(() => root.render(<RoutingQueue />));
  try {
    expect(container.querySelector('select[aria-label="Filter by work type"]')).toBeNull();
    expect(container.textContent).toContain('No service claims need finance action');
    expect(container.textContent).not.toContain('Review amount');
  } finally {
    mockItem.work_type = 'SERVICES';
    act(() => root.unmount());
    container.remove();
  }
});

test('historical finance item with no captured amount is marked not prepared', () => {
  mockItem.amount = null;
  mockItem.currency = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<RoutingQueue />));
  try {
    expect(container.textContent).toContain('Not prepared');
    expect(container.textContent).not.toContain('TZS null');
  } finally {
    mockItem.amount = '173450';
    mockItem.currency = 'TZS';
    act(() => root.unmount());
    container.remove();
  }
});
