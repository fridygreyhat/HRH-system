import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { ServicesProofPaymentDialog } from './ServicesProofPaymentDialog';
import { api } from '../../api';

let mockEligible, container, root;
jest.mock('../../api', () => ({ api: { upload: jest.fn() } }));
jest.mock('../../hooks', () => ({
  useApi: () => ({ data: mockEligible, error: null, loading: false, reload: jest.fn() }),
  useAction: () => ({ busy: false, error: null, run: fn => fn() }),
}));

const manifest = {
  claim_id: 5, provider_id: 2, provider_name: 'Asha Mushi', services: ['Home visits'], amount: '40000.00',
  amount_recorded: '0.00', outstanding_amount: '40000.00', currency: 'TZS', can_record_with_proof: true,
};
const saveButton = () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Save proof'));

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockEligible = [manifest]; api.upload.mockReset();
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('with no claims it explains why there is nothing to upload', () => {
  mockEligible = [];
  act(() => root.render(<ServicesProofPaymentDialog onClose={jest.fn()} onDone={jest.fn()} />));
  expect(container.textContent).toContain('No Services claims are ready for proof yet.');
  expect(container.textContent).toContain('Central Finance reviewer approves them');
  expect(container.querySelector('input[type=file]')).toBeNull();
  expect(saveButton()).toBeUndefined();
});

test('it says what is missing, then uploads the proof with the selected claim', async () => {
  const done = jest.fn();
  api.upload.mockResolvedValue({ paid_claim_ids: [5], paid_count: 1 });
  act(() => root.render(<ServicesProofPaymentDialog onClose={jest.fn()} onDone={done} />));
  expect(container.textContent).toContain('To save: select at least one claim, enter the payment reference, choose the proof document, tick the confirmation.');
  expect(saveButton().disabled).toBe(true);

  const file = new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' });
  const boxes = container.querySelectorAll('input[type=checkbox]');
  act(() => {
    Simulate.change(boxes[0], { target: { checked: true } });
    Simulate.change(container.querySelector('.grid-2 input:not([type])'), { target: { value: 'BANK-123' } });
    Simulate.change(container.querySelector('input[type=file]'), { target: { files: [file] } });
    Simulate.change(boxes[1], { target: { checked: true } });
  });
  expect(container.textContent).not.toContain('To save:');
  expect(saveButton().disabled).toBe(false);
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(api.upload).toHaveBeenCalledWith('/claims/services/proof-payment', expect.any(FormData));
  const form = api.upload.mock.calls[0][1];
  expect(form.get('file').name).toBe('proof.pdf');
  expect(form.get('payment_reference')).toBe('BANK-123');
  expect(JSON.parse(form.get('beneficiaries'))[0].claim_id).toBe(5);
  expect(done).toHaveBeenCalled();
});

test('a file of the wrong type is refused with a message', () => {
  act(() => root.render(<ServicesProofPaymentDialog onClose={jest.fn()} onDone={jest.fn()} />));
  const file = new File(['x'], 'proof.docx', { type: 'application/msword' });
  act(() => Simulate.change(container.querySelector('input[type=file]'), { target: { files: [file] } }));
  expect(container.textContent).toContain('Choose a PDF, PNG or JPEG document.');
});
