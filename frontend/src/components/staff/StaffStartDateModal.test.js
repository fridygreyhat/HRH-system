import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { StaffStartDateModal } from './StaffStartDateModal';
import { api } from '../../api';

jest.mock('../../api', () => ({ api: { patch: jest.fn() } }));

const staff = {
  id: 42, legal_name: 'Date Correction', employment_start_date: '2026-10-01', employment_end_date: null,
  assignments: [
    { id: 2, start_date: '2026-11-01', region: 'Iringa', facility: 'Second facility' },
    { id: 1, start_date: '2026-10-01', region: 'Iringa', facility: 'Initial facility' },
  ],
};

test('staff start-date form requires a reason and explicitly opts into initial placement correction', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const saved = jest.fn();
  api.patch.mockResolvedValue({ applied: true });
  try {
    act(() => root.render(<StaffStartDateModal staff={staff} onSaved={saved} onClose={() => {}} />));
    const form = document.querySelector('form');
    const save = [...form.querySelectorAll('button')].find(b => b.textContent === 'Save start date');
    const placement = form.querySelector('input[type="checkbox"]');
    expect(save.disabled).toBe(true);
    expect(placement.checked).toBe(false);
    expect(form.textContent).toContain('Initial facility');
    expect(form.textContent).not.toContain('Second facility');
    act(() => {
      Simulate.change(form.querySelector('input[type="date"]'), { target: { value: '2026-09-01' } });
      Simulate.change(form.querySelector('textarea'), { target: { value: 'Correct registration' } });
      Simulate.change(placement, { target: { checked: true } });
    });
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(api.patch).toHaveBeenCalledWith('/staff/42/start-date', {
      start_date: '2026-09-01', update_initial_assignment: true, reason: 'Correct registration',
    });
    expect(saved).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
