/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayrollToCso } from './PayrollToCso';

let mockStatus = [];
jest.mock('../AuthContext', () => ({ useAuth: () => ({ lang: 'en' }) }));
jest.mock('../hooks', () => ({ useApi: () => ({ data: mockStatus, error: null, loading: false, reload: () => {} }) }));

const item = (region, state, extra = {}) => ({ month: '2026-10', region_id: region === 'Iringa' ? 11 : 22, region_name: region, work_type: 'PAYROLL', state,
  providers: 3, approved_at: state === 'SIGNED' ? '2026-11-14T14:11:29+03:00' : null, approved_by_name: state === 'SIGNED' ? 'Jonas Abel' : null, can_approve: true, ...extra });

test('Regional Finance sees each region\'s Payroll and whether it has gone to the CSO', () => {
  mockStatus = [item('Iringa', 'NOT_SIGNED'), item('Njombe', 'SIGNED'), { ...item('Iringa', 'SIGNED'), work_type: 'SERVICES' }];
  const html = renderToStaticMarkup(<PayrollToCso />);
  expect(html).toContain('Payroll to CSO');
  expect(html).toContain('1 Payroll report has not been sent to the CSO.');
  expect(html).toContain('October 2026 · Iringa');
  expect(html).toContain('Review and send to CSO');
  expect(html).toContain('Sent to CSO');
  expect(html).toContain('Jonas Abel');
  expect(html.match(/payroll-row/g)).toHaveLength(2); // the Services sign-off is not listed here
});

test('with nothing approved, the page says so', () => {
  mockStatus = [];
  expect(renderToStaticMarkup(<PayrollToCso />)).toContain('No RM-approved Payroll in the last three pay months.');
});

test('a region with Payroll timesheets still to approve is approved first, not signed', () => {
  mockStatus = [item('Iringa', 'NOT_SIGNED', { to_approve: 4 })];
  const html = renderToStaticMarkup(<PayrollToCso />);
  expect(html).toContain('Approve 4 timesheets first');
  expect(html).not.toContain('Review and send to CSO');
});
