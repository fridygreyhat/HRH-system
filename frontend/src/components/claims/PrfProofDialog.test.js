import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { PrfProofDialog } from './PrfProofDialog';
import * as apiModule from '../../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockRows = [];
jest.mock('../../hooks', () => ({
  useApi: () => ({ data: mockRows, error: null, loading: false, reload: jest.fn() }),
  useAction: () => ({ busy: false, error: null, run: async (fn) => fn() }),
}));
const row = (id, name, amount, extra = {}) => ({ claim_id: id, provider_name: name, services: ['Outreach'], amount, outstanding_amount: amount, currency: 'TZS', can_record_with_proof: true, payment_status: 'NOT_STARTED', ...extra });

function render(onDone = jest.fn()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<PrfProofDialog prf={{ id: 7, prf_number: 'PRF/7' }} onClose={jest.fn()} onDone={onDone} />));
  return { container, onDone, close: () => { act(() => root.unmount()); container.remove(); } };
}

function type(input, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

test('one proof pays every unpaid claim on the PRF', async () => {
  mockRows = [row(1, 'Asha', '300.00'), row(2, 'Baraka', '450.00'), row(3, 'Paid already', '100.00', { payment_status: 'PAID' })];
  const upload = jest.spyOn(apiModule.api, 'upload').mockResolvedValue({ paid_count: 2 });
  const { container, onDone, close } = render();
  try {
    expect(container.textContent).toContain('2 claims to pay');
    expect(container.textContent).toContain('TZS 750');
    expect(container.textContent).toContain('1 already paid');
    const save = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save proof and payment');
    expect(save().disabled).toBe(true);
    await act(async () => {
      type(container.querySelector('input[maxlength="200"]'), 'BANK-1');
      const file = new File(['%PDF'], 'schedule.pdf', { type: 'application/pdf' });
      const input = container.querySelector('input[type=file]');
      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      container.querySelector('.check-line input').click();
    });
    expect(save().disabled).toBe(false);
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(upload).toHaveBeenCalledWith('/finance/services-payment-report/prf/7/proof', expect.any(FormData));
    const form = upload.mock.calls[0][1];
    expect(form.get('payment_reference')).toBe('BANK-1');
    expect(form.get('beneficiaries_confirmed')).toBe('true');
    expect(onDone).toHaveBeenCalledWith(2);
  } finally { close(); upload.mockRestore(); }
});

test('a claim not ready for payment blocks the upload and is named', () => {
  mockRows = [row(1, 'Asha', '300.00'), row(2, 'Waiting', '450.00', { can_record_with_proof: false })];
  const { container, close } = render();
  try {
    expect(container.textContent).toContain('1 claim(s) are not ready for payment');
    expect(container.textContent).toContain('#2');
  } finally { close(); }
});
