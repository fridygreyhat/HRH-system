import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { CsoPortal } from './CsoPortal';
import { money } from '../format';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../AuthContext', () => ({
  useAuth: () => ({ me: { id: 4, organizations: [{ id: 10, name: 'Kijiji Health CSO', type: 'CSO' }, { id: 90, name: 'FHI360', type: 'FHI360' }] } }),
}));
jest.mock('../api', () => ({ api: { post: jest.fn() } }));
jest.mock('../hooks', () => ({
  useApi: path => ({
    data: path === '/claims' || path === '/batches' ? [] : [
      { id: 1, code: 'KH-01', name: 'Facility support', source: 'MANUAL', organization_id: 10, organization_name: 'Kijiji Health CSO', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'Services', period_id: 21, period_label: 'January', allocated_amount: 100, committed_amount: 20, spent_amount: 10, available_amount: 70, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 2, code: 'KH-02', name: 'Outreach', source: 'MANUAL', organization_id: 10, organization_name: 'Kijiji Health CSO', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'Services', period_id: 22, period_label: 'February', allocated_amount: 50, committed_amount: 5, spent_amount: 15, available_amount: 30, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 3, code: 'FHI-01', name: 'FHI allocation', source: 'FHI360_TRACKER', organization_id: 90, organization_name: 'FHI360', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'Services', period_id: 21, period_label: 'January', allocated_amount: 800, committed_amount: 0, spent_amount: 0, available_amount: 800, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 4, code: 'OTHER-01', name: 'Other CSO allocation', source: 'MANUAL', organization_id: 11, organization_name: 'Other CSO', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'Services', period_id: 21, period_label: 'January', allocated_amount: 500, committed_amount: 0, spent_amount: 0, available_amount: 500, currency: 'TZS', sync_status: 'RECONCILED' },
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
    expect(container.textContent).toContain('Category / activity');
    expect(container.textContent).toContain('Pay period');
    expect(container.textContent).not.toContain('FHI allocation');
    expect(container.textContent).not.toContain('Other CSO allocation');
    expect(container.querySelectorAll('.budget-period')).toHaveLength(2);

    const regionSummary = container.querySelector('.budget-region > summary');
    expect(regionSummary.textContent).toContain('Allocated');
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
