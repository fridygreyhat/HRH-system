/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Home, monthProgress } from './Home';

let mockRoles = [];
let mockData = {};
jest.mock('../AuthContext', () => ({
  useAuth: () => ({
    me: { id: 4, full_name: 'DEMO Asha Juma', roles: mockRoles }, lang: 'en',
    hasRole: (...roles) => roles.some((role) => mockRoles.includes(role)),
  }),
}));
jest.mock('../hooks', () => ({ useApi: (path) => ({ data: path ? mockData[path] ?? [] : null }), useAction: () => ({}) }));

const home = (roles, data = {}) => { mockRoles = roles; mockData = data; return renderToStaticMarkup(<Home />); };

test('every login gets a home page with something to do', () => {
  const roles = ['PROVIDER', 'SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'FHI360_FINANCE',
    'CSO_FINANCE', 'COMMUNITY_VERIFIER', 'OVERSIGHT', 'CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'SYSTEM_ADMIN'];
  roles.forEach((role) => expect([role, home([role]).includes('task-card')]).toEqual([role, true]));
});

test('a Super Admin gets a setup checklist and their own work, not every role\'s', () => {
  const html = home(['SUPER_ADMIN'], { '/organizations': { organizations: [] } });
  expect(html).toContain('Set up your system');
  expect(html).toContain('Add your CSOs and link their regions');
  expect(html).toContain('Register your providers');
  expect(html).not.toContain("My facility's timesheets");
  expect(html).not.toContain('Fill in my timesheet');
});

test('reviewers do not see the setup checklist', () => {
  expect(home(['RPM'])).not.toContain('Set up your system');
});

test('a reviewer sees live counts for each list, and zero reads as all clear', () => {
  const html = home(['RPM'], { '/worklogs?queue=true&work_type=PAYROLL': [{}, {}, {}] });
  expect(html).toContain('Payroll timesheets');
  expect(html).toContain('>3<');
  expect(html).toContain('All clear');
});

test('Central Finance counts only the claims assigned to them', () => {
  const rows = [{ status: 'PENDING_CENTRAL_REVIEW', central_reviewer_id: 4 }, { status: 'PENDING_CENTRAL_REVIEW', central_reviewer_id: 9 }, { status: 'READY', central_reviewer_id: 4 }];
  expect(home(['FHI360_FINANCE'], { '/claims': rows })).toContain('>1<');
});

test('a provider sees returned work and greets them by name without the DEMO prefix', () => {
  const html = home(['PROVIDER'], { '/worklogs?mine=true': [{ status: 'RETURNED_TO_PROVIDER' }, { status: 'APPROVED' }] });
  expect(html).toContain('Needs my correction');
  expect(html).toContain('Asha');
  expect(html).not.toContain('Good morning, DEMO');
});

test.each([
  ['2026-10-26', '2026-11', '2026-11-25', 30],
  ['2026-11-25', '2026-11', '2026-11-25', 0],
  ['2026-12-26', '2027-01', '2027-01-25', 30],
])('on %s the work month is %s', (today, month, last, left) => {
  expect(monthProgress(today)).toMatchObject({ month, last, left });
});

test('a provider sees this month\'s timesheet, reviews and payments as headline numbers', () => {
  const html = home(['PROVIDER'], {
    '/admin/pay-periods': [{ id: 7, start_date: '2000-01-01', end_date: '2999-12-31', status: 'OPEN' }],
    '/worklogs?mine=true': [
      { id: 2, period_id: 7, work_type: 'PAYROLL', status: 'DRAFT', entry_count: 3, total_hours: 24 },
      { id: 1, period_id: 9, work_type: 'SERVICES', status: 'PAID', entry_count: 5, total_hours: 20 },
    ],
  });
  expect(html).toContain('Payroll this month');
  expect(html).toContain('3 days');
  expect(html).toContain('With reviewers');
  expect(html).toContain('My recent timesheets');
});

test('a reviewer sees what waits on them and what is over 24 hours', () => {
  const html = home(['RPM'], {
    '/worklogs?queue=true&work_type=PAYROLL': [{ id: 1, work_type: 'PAYROLL', staff_name: 'Neema Mushi', hours_in_status: 30 }],
    '/worklogs?queue=true&work_type=SERVICES': [{ id: 2, work_type: 'SERVICES', staff_name: 'Juma Ali', hours_in_status: 2 }],
  });
  expect(html).toContain('Waiting on me');
  expect(html).toContain('Over 24 h');
  expect(html).toContain('Waiting longest');
  expect(html).toContain('Neema Mushi');
  expect(html).toContain('2 timesheets wait for your decision.');
});
