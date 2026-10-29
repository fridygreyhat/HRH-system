import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { FinanceMonthlyReport } from './FinanceMonthlyReport';
import { useApi } from '../hooks';
import { useAuth } from '../AuthContext';
import { api, saveBlob } from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let requestedPath = '';
let roleNames = ['REGIONAL_FINANCE'];
const reload = jest.fn();
let envelopeOverrides = {};
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
  useApi: jest.fn(),
}));
jest.mock('../AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  api: { post: jest.fn(), blob: jest.fn() },
  saveBlob: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useApi.mockImplementation(path => {
    if (path?.startsWith('/finance/monthly-report')) requestedPath = path;
    const envelope = {
      state: 'NOT_APPROVED', approval: null, can_approve: true, stale: false,
      digest: 'digest-1', report: summary,
      ...envelopeOverrides,
    };
    return { data: path === '/finance/regions' ? [{ id: 7, name: 'Mara' }] : envelope, error: null, loading: false, reload };
  });
  useAuth.mockImplementation(() => ({ hasRole: (...roles) => roleNames.some(role => roles.includes(role)) }));
  api.post.mockResolvedValue({});
  api.blob.mockResolvedValue({ blob: new Blob(['report']), filename: 'report.csv' });
});

function mountReport() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<FinanceMonthlyReport />));
  return { container, root, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

test('monthly report keeps calendar month, separate work type and cadre aggregates without daily logs', () => {
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

test('regional report requires an explicit review confirmation before document sign-off', async () => {
  const { container, unmount } = mountReport();
  try {
    const approve = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Sign off report'));
    expect(approve).toBeTruthy();
    expect(approve.disabled).toBe(true);
    const region = container.querySelector('select[aria-label="Region"]');
    act(() => Simulate.change(region, { target: { value: '7' } }));
    const checkbox = container.querySelector('.finance-confirm-check input');
    act(() => Simulate.change(checkbox, { target: { checked: true } }));
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent.includes('Sign off report'));
    await act(async () => { Simulate.click(button); });
    expect(api.post).toHaveBeenCalledWith('/finance/monthly-report/approve', expect.objectContaining({
      month: expect.any(String), region_id: 7, work_type: 'PAYROLL', review_confirmed: true, expected_digest: 'digest-1',
    }));
    expect(reload).toHaveBeenCalled();
  } finally { unmount(); }
});

test('CSO documentation is read-only and shows signer and changed-work notice', () => {
  roleNames = ['CSO_FINANCE'];
  envelopeOverrides = {
    state: 'APPROVED', stale: true,
    approval: { id: 3, month: '2025-05', region_id: 7, region_name: 'Mara', work_type: 'PAYROLL', approved_at: '2025-06-02T09:30:00Z', approved_by_name: 'Regional Finance' },
  };
  const { container, unmount } = mountReport();
  try {
    expect(container.textContent).toContain('Read-only documentation view');
    expect(container.textContent).toContain('Regional Finance');
    expect(container.textContent).toContain('New or changed work');
    expect(container.querySelector('.finance-confirm-check')).toBeNull();
    expect(container.textContent).not.toContain('Approve report');
  } finally { unmount(); roleNames = ['REGIONAL_FINANCE']; envelopeOverrides = {}; }
});

test('CSV and PDF exports use authenticated blob endpoint with current report filters', async () => {
  const { container, unmount } = mountReport();
  try {
    const csv = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Download CSV'));
    await act(async () => { Simulate.click(csv); });
    expect(api.blob).toHaveBeenCalledWith(expect.stringMatching(/monthly-report\/export.*format=csv/), 'GET', expect.any(String));
    expect(saveBlob).toHaveBeenCalled();
    const pdf = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Download PDF'));
    await act(async () => { Simulate.click(pdf); });
    expect(api.blob).toHaveBeenLastCalledWith(expect.stringMatching(/monthly-report\/export.*format=pdf/), 'GET', expect.any(String));
  } finally { unmount(); }
});

test('stale sign-off conflict refreshes the report and keeps a visible error', async () => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('Report changed; refresh and review again.'), { status: 409 }));
  const { container, unmount } = mountReport();
  try {
    const checkbox = container.querySelector('.finance-confirm-check input');
    act(() => Simulate.change(checkbox, { target: { checked: true } }));
    const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent.includes('Sign off report'));
    await act(async () => { Simulate.click(button); });
    expect(container.textContent).toContain('Report changed; refresh and review again.');
    expect(reload).toHaveBeenCalled();
  } finally { unmount(); }
});

test('download authorization failures are shown in the page', async () => {
  api.blob.mockRejectedValueOnce(new Error('Your session has expired. Please sign in again.'));
  const { container, unmount } = mountReport();
  try {
    const csv = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Download CSV'));
    await act(async () => { Simulate.click(csv); });
    expect(container.textContent).toContain('Your session has expired. Please sign in again.');
  } finally { unmount(); }
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
