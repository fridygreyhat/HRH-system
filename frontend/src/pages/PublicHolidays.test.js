import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { PublicHolidays } from './PublicHolidays';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mockPost = jest.fn();
const mockDel = jest.fn();
const mockReload = jest.fn();

jest.mock('../api', () => ({ api: { post: (...args) => mockPost(...args), del: (...args) => mockDel(...args) }, qs: params => `?year=${params.year}` }));
jest.mock('../hooks', () => ({
  useApi: () => ({
    data: [
      { id: null, date: '2026-12-09', name_en: 'Independence Day', name_sw: 'Siku ya Uhuru' },
      { id: 4, date: '2026-03-20', name_en: 'Eid al-Fitr', name_sw: 'Idd el-Fitr' },
    ],
    error: null, loading: false, reload: mockReload,
  }),
  useAction: () => ({ busy: false, error: null, run: async fn => fn() }),
}));

test('An administrator adds an announced holiday and removes only entered ones', async () => {
  mockPost.mockResolvedValue({});
  mockDel.mockResolvedValue({});
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<PublicHolidays />));
  try {
    expect(container.textContent).toContain('Every year');
    const removeButtons = Array.from(container.querySelectorAll('button')).filter(button => button.textContent === 'Remove');
    expect(removeButtons).toHaveLength(1);
    const [name, swahili] = container.querySelectorAll('input[maxlength="100"]');
    await act(async () => Simulate.change(container.querySelector('input[type="date"]'), { target: { value: '2027-03-10' } }));
    await act(async () => Simulate.change(name, { target: { value: ' Eid al-Fitr ' } }));
    await act(async () => Simulate.change(swahili, { target: { value: 'Idd el-Fitr' } }));
    await act(async () => Simulate.submit(container.querySelector('form'), { preventDefault() {} }));
    expect(mockPost).toHaveBeenCalledWith('/public-holidays', { holiday_date: '2027-03-10', name_en: 'Eid al-Fitr', name_sw: 'Idd el-Fitr' });
    await act(async () => Simulate.click(removeButtons[0]));
    const form = Array.from(document.querySelectorAll('form')).pop();
    await act(async () => Simulate.submit(form, { preventDefault() {} }));
    expect(mockDel).toHaveBeenCalledWith('/public-holidays/4');
    expect(mockReload).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
