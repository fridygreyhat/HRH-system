import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { CsoPortal } from './CsoPortal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockCommunityClaim = null;
const noSalary = { regions: [], providers: [], settings: [], holidays: [], missing_bank: [], missing_salary: [], not_signed: [], totals: { providers: 0, days_signed: 0, hours: '0', salary: '0' } };
let mockSalary = noSalary;
let mockOrganizations = [{ id: 10, name: 'Kijiji Health CSO' }];
let mockPeriods = [{ id: 21, start_date: '2025-01-01', end_date: '2025-01-31', period_label: 'January 2025', status: 'OPEN' }];
const mockBlob = jest.fn();
const mockSaveBlob = jest.fn();

jest.mock('../AuthContext', () => ({
  useAuth: () => ({ me: { id: 4, organizations: [{ id: 10, name: 'Kijiji Health CSO', type: 'CSO' }, { id: 90, name: 'FHI360', type: 'FHI360' }] } }),
}));
jest.mock('../api', () => ({ api: { post: jest.fn(), blob: (...args) => mockBlob(...args) }, qs: params => (params.month ? `?cso_id=${params.cso_id}&month=${params.month}${params.setting ? `&setting=${params.setting}` : ''}${params.format ? `&format=${params.format}` : ''}` : `?cso_id=${params.cso_id}&period_id=${params.period_id}`), saveBlob: (...args) => mockSaveBlob(...args) }));
jest.mock('../hooks', () => ({
  useApi: path => ({
    data: path === null ? null : path.startsWith('/cso-finance/salary-timesheets') ? mockSalary : path === '/claims' ? (mockCommunityClaim ? [mockCommunityClaim] : []) : path === '/batches' ? [] : path === '/cso-finance/pay-periods' ? mockPeriods : path === '/cso-finance/organizations' ? mockOrganizations : [
      { id: 1, code: 'KH-01', name: 'Facility support', source: 'MANUAL', organization_id: 10, organization_name: 'Kijiji Health CSO', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'CHW PNP assistance', activity_type: 'SERVICES', period_id: 21, period_label: 'January', allocated_amount: 100, committed_amount: 20, spent_amount: 10, available_amount: 70, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 2, code: 'KH-02', name: 'Outreach', source: 'MANUAL', organization_id: 10, organization_name: 'Kijiji Health CSO', region_id: 7, region_name: 'Mara', category_id: 6, category_name: 'Community service item', activity_type: 'SERVICES', period_id: 22, period_label: 'February', allocated_amount: 50, committed_amount: 5, spent_amount: 15, available_amount: 30, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 3, code: 'FHI-01', name: 'FHI allocation', source: 'FHI360_TRACKER', organization_id: 90, organization_name: 'FHI360', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'Services', activity_type: 'SERVICES', period_id: 21, period_label: 'January', allocated_amount: 800, committed_amount: 0, spent_amount: 0, available_amount: 800, currency: 'TZS', sync_status: 'RECONCILED' },
      { id: 4, code: 'OTHER-01', name: 'Other CSO allocation', source: 'MANUAL', organization_id: 11, organization_name: 'Other CSO', region_id: 7, region_name: 'Mara', category_id: 5, category_name: 'Services', activity_type: 'SERVICES', period_id: 21, period_label: 'January', allocated_amount: 500, committed_amount: 0, spent_amount: 0, available_amount: 500, currency: 'TZS', sync_status: 'RECONCILED' },
    ],
    error: null, loading: false, reload: jest.fn(),
  }),
  useAction: () => ({ busy: false, error: null, run: async fn => fn() }),
}));

test('CSO portal removes budget section and retains payment/reconciliation navigation', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<CsoPortal />));
  try {
    expect(container.textContent).toContain('Kijiji Health CSO');
    expect(Array.from(container.querySelectorAll('.subnav button')).map(button => button.textContent)).not.toContain('Budget');
    expect(container.querySelector('.budget-hierarchy')).toBeNull();
    expect(container.textContent).toContain('Reconciliation');
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
    expect(container.textContent).toContain('No regional budget allocation or payroll export batch is required');
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
    const exportTab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent === 'Salary timesheets');
    await act(async () => Simulate.click(exportTab));
    expect(container.textContent).toContain('does not transfer money or change claim status');
    expect(container.textContent).toContain('bank payment details only');
    const periodSelect = Array.from(container.querySelectorAll('select')).find(select => select.value === '21');
    expect(periodSelect.value).toBe('21');
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    expect(mockBlob).toHaveBeenCalledWith('/cso-finance/export-payroll?cso_id=10&period_id=21', 'GET', 'payroll-export.csv');
    expect(mockSaveBlob).toHaveBeenCalledWith({ blob: expect.any(Blob), filename: 'payroll.csv' });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('CSO downloads signed salary timesheets as PDF or CSV and is told which regions are missing', async () => {
  mockSalary = {
    regions: [
      { id: 7, name: 'Mara', signed: true, included: true, approved_by_name: 'Regional Finance Mara', approved_at: '2025-02-03', providers: 2, providers_without_cso: 1 },
      { id: 8, name: 'Kagera', signed: false, included: true, approved_by_name: null, approved_at: null, providers: 0, providers_without_cso: 0 },
    ],
    providers: [
      { staff_id: 1, provider_name: 'Asha Juma', cadre_name: 'Community Health Worker', facility_name: '—', community_area_name: 'Kijiji Nyamongo', work_setting: 'Community', region_name: 'Mara', days_signed: 21, monthly_salary: '750000.00', checks: ['Bank details missing'] },
      { staff_id: 2, provider_name: 'Neema Paul', cadre_name: 'Data Clerk', facility_name: 'Musoma Hospital', community_area_name: null, work_setting: 'Facility', region_name: 'Mara', days_signed: 19, monthly_salary: null, checks: ['Salary amount missing'] },
    ],
    settings: [{ name: 'Facility', providers: 1, salary: '0' }, { name: 'Community', providers: 1, salary: '750000.00' }],
    holidays: [{ date: '2026-12-09', name_en: 'Independence Day' }],
    missing_bank: ['Asha Juma'],
    missing_salary: ['Neema Paul'],
    not_signed: ['Baraka Ali'],
    totals: { providers: 2, days_signed: 40, hours: '320.5', salary: '1500000.00' },
  };
  mockBlob.mockClear();
  mockBlob.mockResolvedValue({ blob: new Blob(['file']), filename: 'salary.pdf' });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<CsoPortal />));
  try {
    const tab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent === 'Salary timesheets');
    await act(async () => Simulate.click(tab));
    expect(container.textContent).toContain('it does not pay anyone or change any record');
    expect(container.textContent).toContain('signed by Regional Finance Mara');
    expect(container.textContent).toContain("Kagera: not signed yet, so its timesheets are not in the file");
    expect(container.textContent).toContain('320 h 30 min');
    expect(container.textContent).toContain('1,500,000');
    expect(container.textContent).toContain('Bank details missing (1): Asha Juma');
    expect(container.textContent).toContain('No salary amount (1): Neema Paul');
    expect(container.textContent).toContain('Not signed by the provider (1): Baraka Ali');
    expect(container.textContent).toContain('Mara: 1 signed provider has no CSO on their placement');
    expect(container.textContent).toContain('Community: 1 provider');
    expect(container.textContent).toContain('Kijiji Nyamongo');
    expect(container.textContent).toContain('Public holidays in this month: 09 Dec 2026 Independence Day');
    const month = container.querySelector('input[type="month"]').value;
    const button = text => Array.from(container.querySelectorAll('button')).find(item => item.textContent === text);
    await act(async () => Simulate.click(button('Download PDF')));
    await act(async () => Simulate.click(button('Download CSV')));
    expect(mockBlob).toHaveBeenCalledWith(`/cso-finance/salary-timesheets/export?cso_id=10&month=${month}&format=pdf`, 'GET', `salary-timesheets-${month}.pdf`);
    expect(mockBlob).toHaveBeenCalledWith(`/cso-finance/salary-timesheets/export?cso_id=10&month=${month}&format=csv`, 'GET', `salary-timesheets-${month}.csv`);
    const providers = Array.from(container.querySelectorAll('label')).find(item => item.textContent.startsWith('Providers')).querySelector('select');
    await act(async () => Simulate.change(providers, { target: { value: 'Community' } }));
    await act(async () => Simulate.click(button('Download CSV')));
    expect(mockBlob).toHaveBeenCalledWith(`/cso-finance/salary-timesheets/export?cso_id=10&month=${month}&setting=Community&format=csv`, 'GET', `salary-timesheets-${month}.csv`);
  } finally {
    mockSalary = noSalary;
    act(() => root.unmount());
    container.remove();
  }
});

test('A long list of flagged providers is shortened on screen but keeps the full count', async () => {
  const names = Array.from({ length: 150 }, (_, index) => `Provider ${index + 1}`);
  mockSalary = { ...noSalary, missing_bank: names, totals: { providers: 150, days_signed: 3000, hours: '24000', salary: '0' } };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<CsoPortal />));
  try {
    const tab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent === 'Salary timesheets');
    await act(async () => Simulate.click(tab));
    expect(container.textContent).toContain('Bank details missing (150): Provider 1,');
    expect(container.textContent).toContain('Provider 10 and 140 more, all marked in the list below');
    expect(container.textContent).not.toContain('Provider 11,');
  } finally {
    mockSalary = noSalary;
    act(() => root.unmount());
    container.remove();
  }
});

test('CSO can find any provider before exporting, with region, facility and cadre on each row', async () => {
  const providers = Array.from({ length: 45 }, (_, index) => ({
    staff_id: index + 1, provider_name: `Provider ${index + 1}`, cadre_name: index === 44 ? 'Data Clerk' : 'Community Health Worker',
    facility_name: `Facility ${index + 1}`, region_name: index === 44 ? 'Kagera' : 'Mara', days_signed: 20,
    monthly_salary: index === 44 ? null : '650000.00', checks: index === 44 ? ['Salary amount missing'] : [],
  }));
  mockSalary = { ...noSalary, providers, totals: { providers: 45, days_signed: 900, hours: '7200', salary: '28600000.00' } };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<CsoPortal />));
  try {
    const tab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent === 'Salary timesheets');
    await act(async () => Simulate.click(tab));
    const rows = () => Array.from(container.querySelectorAll('tbody tr')).map(row => row.textContent).filter(text => text.startsWith('Provider '));
    const button = text => Array.from(container.querySelectorAll('button')).find(item => item.textContent === text);
    expect(rows()).toHaveLength(20);
    expect(rows()[0]).toContain('Provider 1');
    expect(rows()[0]).toContain('Mara');
    expect(rows()[0]).toContain('Facility 1');
    expect(rows()[0]).toContain('Community Health Worker');
    expect(rows()[0]).toContain('650,000');
    expect(container.textContent).toContain('1–20 of 45 shown · 45 in the file');
    await act(async () => Simulate.click(button('Next')));
    expect(rows()[0]).toContain('Provider 21');
    const search = container.querySelector('input[type="search"]');
    await act(async () => Simulate.change(search, { target: { value: 'kagera' } }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Provider 45');
    expect(rows()[0]).toContain('Salary amount missing');
    await act(async () => Simulate.change(search, { target: { value: '' } }));
    await act(async () => Simulate.change(container.querySelector('input[type="checkbox"]'), { target: { checked: true } }));
    expect(rows()).toHaveLength(1);
    await act(async () => Simulate.change(search, { target: { value: 'nobody' } }));
    expect(container.textContent).toContain('No providers match');
  } finally {
    mockSalary = noSalary;
    act(() => root.unmount());
    container.remove();
  }
});

test('With no CSO or pay period, the page says what to set up instead of staying blank', async () => {
  const organizations = mockOrganizations;
  const periods = mockPeriods;
  mockOrganizations = [];
  mockPeriods = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<CsoPortal />));
  try {
    const tab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent === 'Salary timesheets');
    await act(async () => Simulate.click(tab));
    expect(container.textContent).toContain('No CSO is linked to this account');
    expect(container.textContent).toContain('An administrator must create one under Pay periods');
    expect(container.querySelector('input[type="month"]')).toBeNull();
  } finally {
    mockOrganizations = organizations;
    mockPeriods = periods;
    act(() => root.unmount());
    container.remove();
  }
});

test('Salary timesheet downloads stay off until a signed timesheet exists', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<CsoPortal />));
  try {
    const tab = Array.from(container.querySelectorAll('.subnav button')).find(button => button.textContent === 'Salary timesheets');
    await act(async () => Simulate.click(tab));
    expect(container.textContent).toContain('No signed timesheets for this month yet');
    const button = text => Array.from(container.querySelectorAll('button')).find(item => item.textContent === text);
    expect(button('Download PDF').disabled).toBe(true);
    expect(button('Download CSV').disabled).toBe(true);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
