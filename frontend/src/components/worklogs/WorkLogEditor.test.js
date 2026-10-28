import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { HeaderForm, DayCalendar } from './WorkLogEditor';
import { api } from '../../api';
import * as format from '../../format';

let mockLanguage = 'en';
jest.mock('../../AuthContext', () => ({ useAuth: () => ({ t: key => key, lang: mockLanguage }) }));
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

test.each(['CHW', 'HCP', 'DATA_CLERK'].flatMap(cadre => ['PAYROLL', 'SERVICES'].map(type => [cadre, type])))(
  '%s %s calendar separates months and restarts weekday alignment',
  (cadre, type) => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const today = jest.spyOn(format, 'todayLocal').mockReturnValue('2026-10-29');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = jest.fn();
    const log = {
      id: 12, work_type: type, cadre: { code: cadre }, can_edit: true,
      period: { start_date: '2026-09-01', end_date: '2026-11-30' },
      entries: [{ entry_date: '2026-10-08', hours_worked: 8 }],
      totals: { hours: 8 }, review_summary: { limits: { sunday_allowed: false } },
    };
    try {
      act(() => root.render(<DayCalendar log={log} selected="2026-09-30" flaggedDates={new Set(['2026-10-08'])} onSelect={onSelect} />));
      const month = container.querySelector('select[aria-label="Calendar month"]');
      expect(month.value).toBe('2026-09');
      expect(month.options).toHaveLength(3);
      expect(container.querySelectorAll('button.day')).toHaveLength(30);
      expect(container.querySelector('[aria-label="Previous month"]').disabled).toBe(true);
      act(() => container.querySelector('[aria-label="Next month"]').click());
      expect(month.value).toBe('2026-10');
      expect(container.querySelectorAll('button.day')).toHaveLength(31);
      expect(container.querySelector('[aria-label*="2026-09-30"]')).toBeNull();
      const grid = container.querySelector('.calendar');
      const first = grid.querySelector('button.day');
      expect(first.getAttribute('aria-label')).toContain('2026-10-01');
      expect([...grid.children].indexOf(first)).toBe(7 + 3); // Thursday, after seven weekday headers.
      const recorded = container.querySelector('[aria-label*="2026-10-08"]');
      expect(recorded.classList.contains('has-entry')).toBe(true);
      expect(recorded.classList.contains('is-flagged')).toBe(true);
      expect(container.querySelector('[aria-label*="2026-10-30"]').disabled).toBe(true);
      act(() => recorded.click());
      expect(onSelect).toHaveBeenLastCalledWith('2026-10-08');
      act(() => Simulate.change(month, { target: { value: '2026-11' } }));
      expect(container.querySelectorAll('button.day')).toHaveLength(30);
      expect(container.querySelector('[aria-label="Next month"]').disabled).toBe(true);
      act(() => container.querySelector('[aria-label="Previous month"]').click());
      expect(month.value).toBe('2026-10');
    } finally {
      act(() => root.unmount());
      container.remove();
      today.mockRestore();
    }
  },
);

test.each([
  ['2026-12-30', '2027-01-02', '2026-12-31', '2027-01-01', 4],
  ['2028-02-28', '2028-03-02', '2028-02-29', '2028-03-01', 2],
])('calendar handles partial months, year boundaries and leap days from %s', (start, end, selected, nextDay, padding) => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const today = jest.spyOn(format, 'todayLocal').mockReturnValue('2028-12-31');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSelect = jest.fn();
  const log = {
    id: 13, work_type: 'SERVICES', cadre: { code: 'HCP' }, can_edit: true,
    period: { start_date: start, end_date: end }, entries: [], totals: { hours: 0 },
    review_summary: { limits: { sunday_allowed: false } },
  };
  try {
    act(() => root.render(<DayCalendar log={log} selected={selected} flaggedDates={new Set()} onSelect={onSelect} />));
    expect(container.querySelectorAll('button.day')).toHaveLength(2);
    act(() => container.querySelector(`[aria-label*="${selected}"]`).click());
    expect(onSelect).toHaveBeenLastCalledWith(selected);
    act(() => container.querySelector('[aria-label="Next month"]').click());
    const grid = container.querySelector('.calendar');
    const first = grid.querySelector('button.day');
    expect(first.getAttribute('aria-label')).toContain(nextDay);
    expect([...grid.children].indexOf(first)).toBe(7 + padding);
    expect(grid.querySelectorAll('button.day')).toHaveLength(2);
  } finally {
    act(() => root.unmount());
    container.remove();
    today.mockRestore();
  }
});

test('Swahili calendar labels months clearly and follows selection of a missing day in another month', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  mockLanguage = 'sw';
  const today = jest.spyOn(format, 'todayLocal').mockReturnValue('2026-10-29');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const log = {
    id: 14, work_type: 'PAYROLL', cadre: { code: 'DATA_CLERK' }, can_edit: true,
    period: { start_date: '2026-09-01', end_date: '2026-10-31' }, entries: [], totals: { hours: 0 },
    review_summary: { limits: { sunday_allowed: false } },
  };
  const render = selected => root.render(<DayCalendar log={log} selected={selected} flaggedDates={new Set()} onSelect={() => {}} />);
  try {
    act(() => render(null));
    expect(container.querySelector('select').value).toBe('2026-10');
    expect(container.querySelector('select').textContent).toContain('Oktoba 2026');
    expect(container.querySelector('.calendar-head').textContent).toBe('Jtt');
    act(() => render('2026-09-01'));
    expect(container.querySelector('select').value).toBe('2026-09');
    expect(container.querySelector('[aria-label*="2026-09-01"]').getAttribute('aria-pressed')).toBe('true');
  } finally {
    mockLanguage = 'en';
    act(() => root.unmount());
    container.remove();
    today.mockRestore();
  }
});
