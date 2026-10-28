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
const originalProviders = summary.providers;

jest.mock('../hooks', () => ({
  useApi: path => {
    if (path?.startsWith('/finance/monthly-summary')) requestedPath = path;
    return { data: path === '/finance/regions' ? [] : summary, error: null, loading: false, reload: jest.fn() };
  },
}));

function mountReport() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<FinanceMonthlyReport />));
  return { container, root, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

test('monthly report requests a calendar month and presents cadre aggregates without daily logs', () => {
  const { container, unmount } = mountReport();
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
    unmount();
  }
});

test('providers are grouped by cadre, searchable and paginated independently; filter changes reset the lists', () => {
  summary.providers = Array.from({ length: 24 }, (_, index) => ({
    staff_id: index + 1,
    provider_name: `Provider ${String(index + 1).padStart(2, '0')}`,
    cadre_code: index === 23 ? 'HCP' : 'CHW',
    cadre_name: index === 23 ? 'Health Care Provider' : 'Community Health Worker',
    facility_name: index === 0 ? 'Special Clinic' : `Facility ${index + 1}`,
    region_name: index === 0 ? 'Lake Region' : 'Mara',
    days: 2,
    hours: '7.5',
    indicators: [],
  }));
  summary.cadres[0].provider_count = 23;
  summary.cadres[1].provider_count = 1;
  const { container, unmount } = mountReport();
  try {
    const groups = container.querySelectorAll('.finance-provider-group');
    expect(groups).toHaveLength(2);
    expect(groups[0].textContent).toContain('1–10 of 23');
    expect(groups[0].querySelectorAll('.finance-provider-list li')).toHaveLength(10);
    expect(groups[1].textContent).toContain('Provider 24');

    act(() => Simulate.click(groups[0].querySelector('[aria-label="Next Community Health Worker providers"]')));
    expect(groups[0].textContent).toContain('Page 2 of 3');
    expect(groups[0].querySelector('.finance-provider-list').textContent).toContain('Provider 11');
    expect(groups[1].textContent).toContain('Provider 24');

    const search = groups[0].querySelector('input[type="search"]');
    act(() => Simulate.change(search, { target: { value: 'Special Clinic' } }));
    expect(groups[0].textContent).toContain('1–1 of 1');
    expect(groups[0].textContent).toContain('Provider 01');
    expect(groups[0].textContent).toContain('Cadre totals stay fixed when this list is searched.');

    act(() => Simulate.change(search, { target: { value: '' } }));
    act(() => Simulate.click(groups[0].querySelector('[aria-label="Next Community Health Worker providers"]')));
    act(() => Simulate.change(container.querySelector('input[aria-label="Calendar month"]'), { target: { value: '2025-06' } }));
    expect(container.querySelector('.finance-provider-group').textContent).toContain('Page 1 of 3');
    expect(requestedPath).toContain('month=2025-06');
    act(() => Simulate.change(container.querySelector('select[aria-label="Work type"]'), { target: { value: 'SERVICES' } }));
    expect(container.querySelector('.finance-provider-group').textContent).toContain('Page 1 of 3');
    expect(requestedPath).toContain('work_type=SERVICES');

    const previous = container.querySelector('[aria-label="Previous Community Health Worker providers"]');
    expect(previous.disabled).toBe(true);
    const next = container.querySelector('[aria-label="Next Community Health Worker providers"]');
    act(() => Simulate.click(next));
    expect(container.querySelector('.finance-provider-group').textContent).toContain('Page 2 of 3');
  } finally {
    unmount();
    summary.providers = originalProviders;
    summary.cadres[0].provider_count = 1;
    summary.cadres[1].provider_count = 1;
  }
});
