import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { SalaryPayments, salaryPaymentForm } from './SalaryPayments';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockUpload = jest.fn();
const mockReload = jest.fn();
jest.mock('../../api', () => ({ api: { upload: (...args) => mockUpload(...args), post: jest.fn(), blob: jest.fn() }, qs: () => '', saveBlob: jest.fn() }));
jest.mock('../../AuthContext', () => ({ useAuth: () => ({ lang: 'en' }) }));
const mockData = {
  month: '2026-10', proof_required: true,
  totals: { providers: 2, expected: '950000.00', paid: '150000.00', outstanding: '800000.00', unpaid_providers: 1 },
  providers: [
    { staff_id: 1, provider_name: 'Neema Mollel', cadre_name: 'Community Health Worker', region_name: 'Iringa', expected: '150000.00', paid: '150000.00', outstanding: '0.00' },
    { staff_id: 2, provider_name: 'Baraka Mushi', cadre_name: 'Data Clerk', region_name: 'Iringa', expected: '800000.00', paid: '0', outstanding: '800000.00' },
  ],
  payments: [{ id: 5, staff_id: 1, provider_name: 'Neema Mollel', amount: '150000.00', status: 'PAID', payment_date: '2026-10-28',
    payment_reference: 'BANK-001', payment_method: 'BANK', has_proof: true, recorded_by_name: 'CSO Finance', voided: false, void_reason: null }],
};
jest.mock('../../hooks', () => ({
  useApi: () => ({ data: mockData, error: null, loading: false, reload: mockReload }),
  useAction: () => ({ busy: false, error: null, run: async (fn) => fn() }),
}));

test('the request names each provider, and a blank amount means what is due', () => {
  const form = salaryPaymentForm({ csoId: '4', month: '2026-10', chosen: { 2: '', 3: ' 500 ' }, date: '2026-10-28', reference: ' REF-1 ',
    method: 'BANK', status: 'PAID', proof: null });
  expect(JSON.parse(form.get('items'))).toEqual([{ staff_id: 2 }, { staff_id: 3, amount: '500' }]);
  expect(form.get('payment_reference')).toBe('REF-1');
  expect(form.get('proof')).toBeNull();
});

test('a CSO records a salary payment for providers still due, with the bank reference and proof', async () => {
  mockUpload.mockResolvedValue({ recorded: 1 });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<SalaryPayments csoId="4" />));
  try {
    expect(container.textContent).toContain('Still to pay');
    expect(container.textContent).toContain('BANK-001');  // recorded already
    const form = container.querySelector('form[aria-label="Record salary payments"]');
    expect([...form.querySelectorAll('tbody tr')].map((row) => row.textContent)).toEqual([expect.stringContaining('Baraka Mushi')]);
    await act(async () => Simulate.change(form.querySelector('input[aria-label="Baraka Mushi"]'), { target: { checked: true } }));
    await act(async () => Simulate.change(form.querySelector('input[maxlength="200"]'), { target: { value: 'NMB-77' } }));
    await act(async () => Simulate.submit(form, { preventDefault() {} }));
    const [path, body] = mockUpload.mock.calls[0];
    expect(path).toBe('/cso-finance/salary-payments');
    expect(JSON.parse(body.get('items'))).toEqual([{ staff_id: 2 }]);
    expect(body.get('payment_reference')).toBe('NMB-77');
    expect(container.textContent).toContain('Recorded 1 payment (NMB-77).');
    expect(mockReload).toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
