import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkLogDrawer } from './WorkLogDrawer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockRoles;
let mockLog;
jest.mock('../../AuthContext', () => ({
  useAuth: () => ({
    lang: 'en',
    me: { client_settings: { provider_otp_required: false } },
    hasRole: (...roles) => roles.some((role) => mockRoles.includes(role)),
  }),
}));
jest.mock('../../api', () => ({ api: { post: jest.fn() }, ApiError: class extends Error {} }));
jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  useApi: (path) => (path === '/worklogs/7'
    ? { data: mockLog, error: null, loading: false, setData: (next) => { mockLog = next; }, reload: jest.fn() }
    : { data: null, error: null, loading: false, setData: jest.fn(), reload: jest.fn() }),
}));
jest.mock('../../pages/PrintWorkLog', () => ({ PrintWorkLog: () => <article>Standard timesheet form</article> }));

const baseLog = (overrides = {}) => ({
  id: 7, version: 1, status: 'PENDING_FINANCE_REVIEW', staff_name: 'Test Worker', period_label: 'October 2026',
  hours_in_status: 1, workflow_version: 2, work_type: 'SERVICES', location_exception_count: 0, gps_visible: false,
  audit: [], endorsements: [], versions: [], claims: [], review_feedback: [], available_actions: [],
  financial_preview: null, finance_snapshot: null, period_comment: null, entries: [],
  review_summary: { limits: {}, months: [], anomalies: [] },
  totals: { days: 0, hours: 0, measures: {} },
  period: { start_date: '2026-10-01', end_date: '2026-10-31' },
  staff: { name: 'Test Worker' },
  cadre: { code: 'HCP', name: 'HCP', fields: [], activities: [] },
  ...overrides,
});

let container, root;
beforeEach(() => {
  mockLog = baseLog();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const open = async () => act(async () => root.render(<WorkLogDrawer logId={7} onClose={() => {}} />));

test.each(['SUPERVISOR', 'FACILITY_IN_CHARGE', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE'])('%s sees the standard timesheet first, even with no action to take', async (role) => {
  mockRoles = [role];
  await open();
  const text = container.textContent;
  expect(text).toContain('Standard timesheet form');
  expect(text.indexOf('Standard timesheet form')).toBeLessThan(text.indexOf('Monthly provider summary'));
});

test.each(['SUPERVISOR', 'TECHNICAL_OFFICER'])('%s keeps the daily entries as well as the timesheet', async (role) => {
  mockRoles = [role];
  await open();
  expect(container.textContent).toContain('Standard timesheet form');
  expect(container.textContent).toContain('Daily entries');
});

test.each(['CHW', 'HCP', 'DATA_CLERK'])('the timesheet is the same for %s work', async (code) => {
  mockRoles = ['RPM'];
  mockLog = baseLog({ cadre: { code, name: code, fields: [], activities: [] } });
  await open();
  expect(container.textContent).toContain('Standard timesheet form');
});

test('the timesheet appears once, above the decision controls', async () => {
  mockRoles = ['RPM'];
  mockLog = baseLog({ status: 'PENDING_RPM_AUTHORIZATION', available_actions: ['authorize'] });
  await open();
  const text = container.textContent;
  expect(text.split('Standard timesheet form')).toHaveLength(2);
  expect(text.indexOf('Standard timesheet form')).toBeLessThan(text.indexOf('Review and decide'));
});

test('RM sees the task, key numbers and flags before the timesheet', async () => {
  mockRoles = ['RPM'];
  mockLog = baseLog({
    status: 'PENDING_RPM_AUTHORIZATION', available_actions: ['authorize'], totals: { days: 5, hours: 20, measures: {} },
    review_summary: { limits: {}, months: [], anomalies: [{ code: 'X', date: null, message: 'Clients exceed expected' }] },
  });
  await open();
  const text = container.textContent;
  expect(text).toContain('Your turn: review and decide');
  expect(text.indexOf('Your turn')).toBeLessThan(text.indexOf('Standard timesheet form'));
  expect(text.indexOf('Clients exceed expected')).toBeLessThan(text.indexOf('Standard timesheet form'));
  expect(text.split('Clients exceed expected')).toHaveLength(2);
  expect(container.querySelector('.review-bar').textContent).toContain('Go to decision');
});

test('provider details and versions are closed until needed', async () => {
  mockRoles = ['RPM'];
  await open();
  const folded = [...container.querySelectorAll('details')];
  expect(folded.map((node) => node.querySelector('summary').textContent)).toEqual(['Provider details', 'Versions']);
  expect(folded.every((node) => !node.open)).toBe(true);
});

const claim = { id: 3, amount: '4000', currency: 'TZS', status: 'PENDING_FINANCE_REVIEW', payment_status: 'NONE' };
const hasBudgetLeft = () => /budget left/i.test(container.textContent);

test('Regional Finance review 1 shows only the timesheet decision', async () => {
  mockRoles = ['REGIONAL_FINANCE'];
  mockLog = baseLog({ claims: [claim], available_actions: ['finance_timesheet_approve', 'return', 'reject'] });
  await open();
  const text = container.textContent;
  expect(text).toContain('Review 1 of 2 · Timesheet');
  expect(text).toContain('Approve timesheet');
  expect(text).toContain('Standard timesheet form');
  expect(text).not.toContain('Approve Services payment');
  expect(text).not.toContain('Funding source');
  expect(text).not.toContain('Linked claims');
  expect(text).not.toContain('4,000');
  expect(hasBudgetLeft()).toBe(false);
});

test('Regional Finance review 2 is the separate payment decision, with the timesheet folded away', async () => {
  mockRoles = ['REGIONAL_FINANCE'];
  mockLog = baseLog({
    claims: [claim], finance_timesheet_approved_at: '2026-11-05T10:00:00Z',
    available_actions: ['finance_review', 'return', 'reject'],
  });
  await open();
  const text = container.textContent;
  expect(text).toContain('Review 2 of 2 · Services payment');
  expect(text).toContain('Approve Services payment');
  expect(text).toContain('Funding source');
  expect(text).toContain('TZS 4,000');
  expect(text).not.toContain('Approve timesheet');
  expect(container.querySelector('details').textContent).toContain('Timesheet · approved');
  expect(container.querySelector('details').open).toBe(false);
  expect(hasBudgetLeft()).toBe(false);
});

test('approving the timesheet needs a fresh confirmation for the Services payment', async () => {
  const { api } = require('../../api');
  const observed = [];
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observed.push(this); this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  };
  mockRoles = ['REGIONAL_FINANCE'];
  mockLog = baseLog({ available_actions: ['finance_timesheet_approve', 'return', 'reject'] });
  await open();
  const box = () => container.querySelector('input[type="checkbox"]');
  const button = (text, scope = container) => [...scope.querySelectorAll('button')].find((node) => node.textContent === text);
  expect(button('Approve timesheet').disabled).toBe(true);
  await act(async () => box().click());
  expect(button('Approve timesheet').disabled).toBe(false);

  api.post.mockResolvedValue(baseLog({ finance_timesheet_approved_at: '2026-11-05T10:00:00Z', available_actions: ['finance_review', 'return', 'reject'] }));
  await act(async () => button('Approve timesheet').click());
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  await act(async () => button('Approve timesheet', dialogs.at(-1)).click());
  expect(api.post.mock.calls.at(-1)[0]).toBe('/worklogs/7/actions/finance_timesheet_approve');
  expect(api.post.mock.calls.at(-1)[1]).toMatchObject({ review_confirmed: true, review_type: 'SERVICES' });

  await act(async () => root.render(<WorkLogDrawer logId={7} onClose={() => {}} />));
  expect(container.textContent).toContain('Review 2 of 2 · Services payment');
  expect(box().checked).toBe(false);
  expect(box().disabled).toBe(false);
  delete globalThis.IntersectionObserver;
});

test('the stepper shows the two Regional Finance approvals as separate steps', async () => {
  mockRoles = ['REGIONAL_FINANCE'];
  mockLog = baseLog({ finance_timesheet_approved_at: '2026-11-05T10:00:00Z', available_actions: ['finance_review'] });
  await open();
  const steps = [...container.querySelectorAll('.step')];
  const step = (title) => steps.find((node) => node.textContent.includes(title));
  expect(step('Regional finance: timesheet').className).toContain('step-done');
  expect(step('Regional finance: Services payment').className).toContain('step-current');
});

test('records finished before this approval existed show no timesheet step', async () => {
  mockRoles = ['REGIONAL_FINANCE'];
  mockLog = baseLog({ status: 'ROUTED_FHI360' });
  await open();
  const steps = [...container.querySelectorAll('.step')];
  expect(steps.some((node) => node.textContent.includes('Regional finance: timesheet'))).toBe(false);
  expect(steps.find((node) => node.textContent.includes('Regional finance: Services payment')).className).toContain('step-done');
});

test('other roles keep their existing view', async () => {
  mockRoles = ['OVERSIGHT'];
  await open();
  expect(container.textContent).not.toContain('Standard timesheet form');
  expect(container.querySelector('.review-summary')).toBeNull();
  expect(container.querySelector('details')).toBeNull();
});

test('finished Services steps read as completed when audit rows are hidden', async () => {
  mockRoles = ['REGIONAL_FINANCE'];
  await open();
  const step = (title) => [...container.querySelectorAll('.step')].find((item) => item.textContent.includes(title));
  expect(step('CTC verification').querySelector('.step-sub').textContent).toBe('Completed');
  expect(step('Routed to FHI360').querySelector('.step-sub').textContent).toBe('Pending');
});
