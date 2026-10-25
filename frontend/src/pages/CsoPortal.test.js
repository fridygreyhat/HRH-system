import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { CsoPortal } from './CsoPortal';
import { money } from '../format';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockCommunityClaim = null;
const mockBlob = jest.fn();
const mockSaveBlob = jest.fn();

jest.mock('../AuthContext', () => ({
  useAuth: () => ({ me: { id: 4, organizations: [{ id: 10, name: 'Kijiji Health CSO', type: 'CSO' }, { id: 90, name: 'FHI360', type: 'FHI360' }] } }),
}));
jest.mock('../api', () => ({ api: { post: jest.fn(), blob: (...args) => mockBlob(...args) }, qs: params => `?cso_id=${params.cso_id}&period_id=${params.period_id}`, saveBlob: (...args) => mockSaveBlob(...args) }));
jest.mock('../hooks', () => ({
  useApi: path => ({
    data: path === '/claims' ? (mockCommunityClaim ? [mockCommunityClaim] : []) : path === '/batches' ? [] : path === '/cso-finance/pay-periods' ? [
      { id: 21, start_date: '2025-01-01', end_date: '2025-01-31', period_label: 'January 2025', status: 'OPEN' },
    ] : path === '/cso-finance/organizations' ? [
      { id: 10, name: 'Kijiji Health CSO' },
    ] : [
      { id: 1, code: 'KH-01', name: 'Facility support', source: 'MANUAL', organization_id: 10, organization_name: 'Kijiji Health CSO', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'CHW PNP assistance', activity_type: 'SERVICES', period_id: 21, period_label: 'January', allocated_amount: 100, committed_amount: 20, spent_amount: 10, available_amount: 70, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 2, code: 'KH-02', name: 'Outreach', source: 'MANUAL', organization_id: 10, organization_name: 'Kijiji Health CSO', region_id: 7, region_name: 'Mara', category_id: 6, category_name: 'Community service item', activity_type: 'SERVICES', period_id: 22, period_label: 'February', allocated_amount: 50, committed_amount: 5, spent_amount: 15, available_amount: 30, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 3, code: 'FHI-01', name: 'FHI allocation', source: 'FHI360_TRACKER', organization_id: 90, organization_name: 'FHI360', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'Services', activity_type: 'SERVICES', period_id: 21, period_label: 'January', allocated_amount: 800, committed_amount: 0, spent_amount: 0, available_amount: 800, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 4, code: 'OTHER-01', name: 'Other CSO allocation', source: 'MANUAL', organization_id: 11, organization_name: 'Other CSO', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'Services', activity_type: 'SERVICES', period_id: 21, period_label: 'January', allocated_amount: 500, committed_amount: 0, spent_amount: 0, available_amount: 500, currency: 'TZS', sync_status: 'RECONCILED' },
    ],
    error: null, loading: false, reload: jest.fn(),
  }),
  useAction: () => ({ busy: false, error: null, run: async fn => fn() }),
}));

test('CSO portal presents scoped regional, category, and pay-period budget hierarchy with aggregated currency totals', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CsoPortal />));
  try {
    const budgetTab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent === 'Budget');
    act(() => Simulate.click(budgetTab));

    expect(container.textContent).toContain('Kijiji Health CSO');
    expect(container.textContent).toContain('Mara');
    expect(container.textContent).toContain('Activity type');
    expect(container.textContent).toContain('Payment item');
    expect(container.textContent).toContain('Pay period');
    expect(container.textContent).not.toContain('FHI allocation');
    expect(container.textContent).not.toContain('Other CSO allocation');
    expect(container.querySelectorAll('.budget-period')).toHaveLength(2);
    expect(Array.from(container.querySelectorAll('.budget-category > summary > strong')).map((node) => node.textContent)).toEqual(['Services']);
    const firstLine = container.querySelector('.budget-line-table tbody tr');
    expect(firstLine.cells[3].textContent).toBe('Services');
    expect(firstLine.cells[4].textContent).toBe('CHW PNP assistance');

    const regionSummary = container.querySelector('.budget-region > summary');
    expect(regionSummary.textContent).toContain('Hard cap');
    expect(regionSummary.textContent).toContain('Committed');
    expect(regionSummary.textContent).toContain('Spent');
    expect(regionSummary.textContent).toContain('Remaining');
    expect(regionSummary.textContent).toContain(money(150, 'TZS'));
    expect(regionSummary.textContent).toContain(money(25, 'TZS'));
    expect(regionSummary.textContent).toContain(money(100, 'TZS'));
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('CSO Community claims section shows incoming direct Route C work with external payment guidance', () => {
  mockCommunityClaim = {
    id: 61, work_log_id: null, staff_id: 12, category_id: 6, period_id: 21, route_code: 'C',
    payor_org_id: 10, executor_org_id: null, budget_line_id: 3, origin_channel: 'COMMUNITY',
    evidence_text: null, declared_units: { visits: 7 }, amount: 36000, currency: 'TZS',
    status: 'PENDING_COMMUNITY_VERIFICATION', payment_status: 'NOT_STARTED', exception_reason: null,
    batch_id: null, created_by: 12, verified_at: null, approved_at: null, created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z', staff_name: 'Neema Juma', category_name: 'Outreach',
    period_label: 'January', payor_name: 'Kijiji Health CSO', executor_name: null, batch_reference: null,
    amount_paid: 0, workflow_version: 2, work_type: 'COMMUNITY',
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CsoPortal />));
  try {
    const routeTab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent.startsWith('Community claims'));
    act(() => Simulate.click(routeTab));
    expect(container.textContent).toContain('Awaiting community verification');
    expect(container.textContent).toContain('Neema Juma');
    expect(container.textContent).toContain('do not need a payroll export batch');
  } finally {
    mockCommunityClaim = null;
    act(() => root.unmount());
    container.remove();
  }
});

test('CSO payroll export downloads a scoped GET CSV and explains it does not transfer funds', async () => {
  mockBlob.mockResolvedValue({ blob: new Blob(['csv']), filename: 'payroll.csv' });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<CsoPortal />));
  try {
    const exportTab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent === 'Payroll export');
    await act(async () => Simulate.click(exportTab));
    expect(container.textContent).toContain('does not transfer money or change claim status');
    expect(container.textContent).toContain('bank payment details only');
    const periodSelect = container.querySelector('select');
    expect(periodSelect.value).toBe('21');
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    expect(mockBlob).toHaveBeenCalledWith('/cso-finance/export-payroll?cso_id=10&period_id=21', 'GET', 'payroll-export.csv');
    expect(mockSaveBlob).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: 'payroll.csv' });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
