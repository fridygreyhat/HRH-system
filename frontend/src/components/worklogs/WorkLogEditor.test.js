import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HeaderForm, DayCalendar } from './WorkLogEditor';
import { api } from '../../api';
import * as format from '../../format';

jest.mock('../../AuthContext', () => ({ useAuth: () => ({ t: key => key, lang: 'en' }) }));
jest.mock('../../api', () => ({ api: { put: jest.fn() } }));
jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  useApi: () => ({ data: [], error: null, loading: false }),
}));

test('Data Clerk header has no period-comment input and does not overwrite historic comments', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const log = {
    id: 7, can_edit: true, period_comment: 'Historic period comment',
    cadre: { code: 'DATA_CLERK', uses_section: false, occupation_options: [] },
  };
  const onSaved = jest.fn();
  api.put.mockResolvedValue(log);
  try {
    act(() => root.render(<HeaderForm log={log} onSaved={onSaved} />));
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toContain('periodComment');
    await act(async () => container.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ));
    expect(api.put).toHaveBeenCalledWith('/worklogs/7', {});
    expect(api.put.mock.calls[0][1]).not.toHaveProperty('period_comment');
    expect(onSaved).toHaveBeenCalledWith(log);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('CHW calendar covers the full month, opens missing dates and excludes Sundays', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const today = jest.spyOn(format, 'todayLocal').mockReturnValue('2026-10-28');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSelect = jest.fn();
  const log = {
    work_type: 'PAYROLL', cadre: { code: 'CHW' }, can_edit: true,
    period: { start_date: '2026-09-01', end_date: '2026-09-30' },
    entries: [{ entry_date: '2026-09-01', hours_worked: 8 }],
    totals: { hours: 8 }, review_summary: { limits: { sunday_allowed: false } },
  };
  try {
    act(() => root.render(<DayCalendar log={log} selected={null} flaggedDates={new Set()} onSelect={onSelect} />));
    expect(container.textContent).toContain('25 past eligible dates have no entry');
    expect(container.textContent).toContain('each date you actually worked');
    expect(container.querySelector('[aria-label*="2026-09-30"]').disabled).toBe(false);
    expect(container.querySelector('[aria-label*="2026-09-06"]').disabled).toBe(true);
    const next = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Open next date without an entry');
    act(() => next.click());
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-02');
    act(() => container.querySelector('[aria-label*="2026-09-30"]').click());
    expect(onSelect).toHaveBeenLastCalledWith('2026-09-30');
  } finally {
    act(() => root.unmount());
    container.remove();
    today.mockRestore();
  }
});
