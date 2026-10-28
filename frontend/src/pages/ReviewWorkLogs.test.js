/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewWorkLogs } from './ReviewWorkLogs';
import { useApi } from '../hooks';

let mockRoles = [];
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ hasRole: (...roles) => roles.some((r) => mockRoles.includes(r)) }),
}));
jest.mock('../hooks', () => ({
  useApi: jest.fn(() => ({ data: [], loading: false, error: null, reload: jest.fn() })),
}));
jest.mock('../components/worklogs/WorkLogDrawer', () => ({ WorkLogDrawer: () => null }));

beforeEach(() => useApi.mockClear());

test('RM initially sees all regional Services and can select Payroll', () => {
  mockRoles = ['RPM'];
  const html = renderToStaticMarkup(<ReviewWorkLogs />);
  const paths = useApi.mock.calls.map(([path]) => path);
  expect(paths).toContain('/worklogs?work_type=SERVICES');
  expect(paths.some((path) => path?.includes('queue=true'))).toBe(false);
  expect(html).toContain('Payroll');
  expect(html).toContain('Services');
  expect(html).toContain('All visible logs');
  expect(html).toContain('RM approval follows technical approval');
});

test('technical officers retain their actionable queue and both work types', () => {
  mockRoles = ['TECHNICAL_OFFICER'];
  const html = renderToStaticMarkup(<ReviewWorkLogs />);
  expect(useApi.mock.calls.map(([path]) => path)).toContain('/worklogs?queue=true&work_type=SERVICES');
  expect(html).toContain('Payroll');
  expect(html).toContain('Waiting on me shows only records at your approval stage');
});
