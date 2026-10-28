import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { FinanceMonthlyReport } from './FinanceMonthlyReport';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let requestedPath = '';
const summary = {
  month: '2025-05',
  work_type: 'PAYROLL',
  totals: { providers: 2, days: 16, hours: '102.5', logs: 2 },
  providers: [
    { staff_id: 4, provider_name: 'Neema Msuya', cadre_code: 'CHW', cadre_name: 'Community Health Worker', facility_name: 'Mara Dispensary', region_name: 'Mara', days: 8, hours: '48.5', indicators: [{ key: 'visits', label: 'Home visits', total: '31' }] },
    { staff_id: 8, provider_name: 'Asha Mallya', cadre_code: 'HCP', cadre_name: 'Health Care Provider', facility_name: 'Mara Clinic', region_name: 'Mara', days: 8, hours: '54', indicators: [{ key: 'consults', label: 'Consultations', total: '47' }] },
  ],
  cadres: [
    { code: 'CHW', name: 'Community Health Worker', provider_count: 1, days: 8, hours: '48.5', indicators: [{ key: 'visits', label: 'Home visits', total: '31' }] },
    { code: 'HCP', name: 'Health Care Provider', provider_count: 1, days: 8, hours: '54', indicators: [{ key: 'consults', label: 'Consultations', total: '47' }] },
  ],
};

jest.mock('../hooks', () => ({
  useApi: path => {
    if (path?.startsWith('/finance/monthly-summary')) requestedPath = path;
    return { data: path === '/finance/regions' ? [] : summary, error: null, loading: false, reload: jest.fn() };
  },
}));

test('monthly report requests a calendar month and presents all cadres as aggregates, without opening daily logs', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<FinanceMonthlyReport />));
  try {
    expect(requestedPath).toContain('month=');
    expect(requestedPath).toContain('work_type=PAYROLL');
    expect(container.textContent).toContain('102.5');
    expect(container.textContent).toContain('Community Health Worker');
    expect(container.textContent).toContain('Health Care Provider');
    expect(container.textContent).toContain('Home visits');
    expect(container.textContent).toContain('Consultations');
    expect(container.textContent).toContain('No daily entries');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    act(() => Simulate.change(container.querySelector('select[aria-label="Work type"]'), { target: { value: 'SERVICES' } }));
    expect(requestedPath).toContain('work_type=SERVICES');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
