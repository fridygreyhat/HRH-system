import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { FinanceReconciliation, providersToShow } from './FinanceReconciliation';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockPost = jest.fn();
const mockReload = jest.fn();
jest.mock('../api', () => ({ api: { post: (...args) => mockPost(...args), blob: jest.fn() }, qs: () => '', saveBlob: jest.fn() }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ lang: 'en' }) }));

const total = (expected, paid, outstanding) => ({ providers: 2, issues: 1, expected, paid, outstanding, overpaid: '0.00', in_review: '30000.00', paid_in_full: 1 });
const provider = (patch) => ({
  work_type: 'PAYROLL', staff_id: 1, provider_name: 'Neema Mollel', cadre_code: 'CHW', cadre_name: 'Community Health Worker',
  region_name: 'Iringa', claim_id: null, expected: '150000.00', paid: '150000.00', outstanding: '0.00', overpaid: '0.00',
  in_review: '0.00', status: 'PAID', status_text: 'Paid in full', issues: [], references: ['BANK-001'], ...patch,
});
const cell = (salaryPaid, servicesPaid, outstanding) => ({ salary_expected: '150000.00', salary_paid: salaryPaid, services_expected: '40000.00',
  services_paid: servicesPaid, services_in_review: '0.00', outstanding, issues: 1, budget_allocated: '5000000.00', budget_used: '40000.00' });
const mockCentral = {
  start: '2025-11', end: '2026-10',
  months: [{ month: '2026-09', ...cell('0.00', '0.00', '0.00'), reconciled: true }, { month: '2026-10', ...cell('150000.00', '10000.00', '30000.00'), reconciled: false }],
  by_region: [
    { region: 'Iringa', total: cell('150000.00', '10000.00', '30000.00'), months: [{ month: '2026-09', ...cell('0.00', '0.00', '0.00') }, { month: '2026-10', ...cell('150000.00', '10000.00', '30000.00') }] },
    { region: 'Njombe', total: cell('0.00', '0.00', '0.00'), months: [{ month: '2026-09', ...cell('0.00', '0.00', '0.00') }, { month: '2026-10', ...cell('0.00', '0.00', '0.00') }] },
  ],
  by_cadre: [{ cadre: 'Community Health Worker', ...cell('150000.00', '0.00', '0.00') }],
  totals: { ...cell('150000.00', '10000.00', '30000.00'), months_reconciled: 1, month_count: 2 },
};
const mockData = {
  month: '2026-10', digest: 'a'.repeat(64), can_sign: true, signoff: null, regions: [{ id: 11, name: 'Iringa' }],
  totals: { PAYROLL: total('150000.00', '150000.00', '0.00'), SERVICES: total('40000.00', '10000.00', '30000.00'), all: total('190000.00', '160000.00', '30000.00') },
  summary: [{ work_type: 'SERVICES', region_name: 'Iringa', cadre_name: 'Health Care Provider', providers: 1, expected: '40000.00', paid: '10000.00', outstanding: '30000.00', overpaid: '0.00', in_review: '0.00', issues: 2 }],
  issues: [{ work_type: 'SERVICES', region_name: 'Iringa', cadre_name: 'Health Care Provider', provider_name: 'Rehema Kileo', claim_id: 7, issue: 'PART_PAID', text: 'Part paid', amount: '30000.00' }],
  providers: [provider({}), provider({ work_type: 'SERVICES', staff_id: 2, provider_name: 'Rehema Kileo', claim_id: 7, cadre_name: 'Health Care Provider',
    expected: '40000.00', paid: '10000.00', outstanding: '30000.00', status: 'PART_PAID', status_text: 'Part paid', issues: ['PART_PAID', 'NO_PROOF'], references: ['SRV-7'] })],
};
const money = (expected, paid, outstanding, in_review = '0.00') => ({ expected, paid, outstanding, overpaid: '0.00', in_review });
const mockDashboard = {
  month: '2026-10', signoff: null,
  months: [
    { month: '2026-09', payroll: money('0.00', '0.00', '0.00'), services: money('0.00', '0.00', '0.00'), budget: { allocated: '0.00', used: '0.00', remaining: '0.00' }, issues: 0, reconciled: false },
    { month: '2026-10', payroll: money('950000.00', '150000.00', '800000.00'), services: money('40000.00', '10000.00', '30000.00', '30000.00'),
      budget: { allocated: '100000.00', used: '40000.00', remaining: '60000.00' }, issues: 3, reconciled: false },
  ],
  totals: { payroll: money('950000.00', '150000.00', '800000.00'), services: money('40000.00', '10000.00', '30000.00', '30000.00'),
    budget: { allocated: '100000.00', used: '40000.00', remaining: '60000.00' }, issues: 3, providers: 3 },
  by_region: [{ key: 'Iringa', label: 'Iringa', payroll_expected: '950000.00', payroll_paid: '150000.00', services_expected: '40000.00', services_paid: '10000.00', outstanding: '830000.00', issues: 3, budget_allocated: '100000.00', budget_used: '40000.00' }],
  by_cadre: [{ key: 'CHW', label: 'Community Health Worker', payroll_expected: '150000.00', payroll_paid: '150000.00', services_expected: '0.00', services_paid: '0.00', outstanding: '0.00', issues: 0 }],
  by_funding: [{ source: 'AFGHS', expected: '40000.00', paid: '10000.00', in_review: '30000.00' }],
};
jest.mock('../hooks', () => ({
  useApi: (path) => ({ data: path && path.includes('/overview') ? mockCentral : path && path.includes('/dashboard') ? mockDashboard : mockData,
    error: null, loading: false, reload: mockReload }),
  useAction: () => ({ busy: false, error: null, run: async (fn) => fn() }),
}));

test('only providers with an issue are listed first, and search covers payment references', () => {
  expect(providersToShow(mockData.providers, '', true).map((p) => p.provider_name)).toEqual(['Rehema Kileo']);
  expect(providersToShow(mockData.providers, 'bank-001', false).map((p) => p.provider_name)).toEqual(['Neema Mollel']);
});

test('Central Finance sees approved against paid and marks the month reconciled with a note', async () => {
  mockPost.mockResolvedValue({});
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<FinanceReconciliation />));
  try {
    const tab = [...container.querySelectorAll('nav.subnav button')].find((b) => b.textContent === 'Reconciliation');
    await act(async () => Simulate.click(tab));
    const text = container.textContent;
    expect(text).toContain('Approved to pay');
    expect(text).toContain('190,000');
    expect(text).toContain('Still to pay');
    expect(text).toContain('Rehema Kileo: Part paid');
    expect(text).toContain('No proof of payment');
    expect(text).not.toContain('BANK-001');  // paid in full: hidden while "only issues" is ticked
    const note = container.querySelector('textarea');
    expect(note.required).toBe(true);
    await act(async () => Simulate.change(note, { target: { value: 'CSO paying the balance on the 28th' } }));
    await act(async () => Simulate.submit(note.closest('form'), { preventDefault() {} }));
    expect(mockPost).toHaveBeenCalledWith('/finance/reconciliation/sign', {
      month: expect.any(String), region_id: null, expected_digest: 'a'.repeat(64), note: 'CSO paying the balance on the 28th' });
    expect(mockReload).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('the one-month dashboard shows salary, Services and budget for the month', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<FinanceReconciliation />));
  try {
    const tab = [...container.querySelectorAll('nav.subnav button')].find((b) => b.textContent === 'One month');
    await act(async () => Simulate.click(tab));
    const text = container.textContent;
    expect(text).toContain('Salaries signed');
    expect(text).toContain('950,000');
    expect(text).toContain('Services budget used');
    expect(text).toContain('40%');  // 40,000 of 100,000
    for (const title of ['Salaries by month', 'Services by month', 'Services budget by month', 'By region this month', 'By cadre this month', 'Services by funding source']) {
      expect(text).toContain(title);
    }
    expect(text).toContain('AFGHS');
    expect(text).not.toContain('Download Excel');  // the files are on the Reconciliation tab
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('the central dashboard opens first: every region, every month, salaries and Services paid', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<FinanceReconciliation />));
  try {
    const text = container.textContent;
    expect(text).toContain('Total paid');
    expect(text).toContain('160,000');  // 150,000 salaries + 10,000 Services
    expect(text).toContain('Months reconciled');
    expect(text).toContain('1 / 2');
    for (const title of ['Paid every month', 'Paid in each region', 'Paid to each cadre', 'Every region, month by month']) {
      expect(text).toContain(title);
    }
    const matrix = [...container.querySelectorAll('section.card table.table tbody tr')].map((row) => row.textContent);
    expect(matrix[0]).toContain('Iringa');
    expect(matrix[matrix.length - 1]).toContain('All regions');
    const show = [...container.querySelectorAll('select')].find((select) => [...select.options].some((o) => o.value === 'outstanding'));
    await act(async () => Simulate.change(show, { target: { value: 'outstanding' } }));
    expect(container.querySelector('section.card table.table tbody tr').textContent).toContain('30,000');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
