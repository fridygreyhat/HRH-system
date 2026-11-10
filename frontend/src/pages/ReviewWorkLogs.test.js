/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewWorkLogs } from './ReviewWorkLogs';
import { useApi } from '../hooks';

let mockRoles = [];
let mockLang;
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ lang: mockLang, hasRole: (...roles) => roles.some((r) => mockRoles.includes(r)) }),
}));
jest.mock('../hooks', () => ({
  useApi: jest.fn(() => ({ data: [], loading: false, error: null, reload: jest.fn() })),
}));
jest.mock('../components/worklogs/WorkLogDrawer', () => ({ WorkLogDrawer: () => null }));

beforeEach(() => { useApi.mockClear(); mockLang = undefined; });

test('RM starts on the records waiting for them and can select Payroll', () => {
  mockRoles = ['RPM'];
  const html = renderToStaticMarkup(<ReviewWorkLogs />);
  const paths = useApi.mock.calls.map(([path]) => path);
  expect(paths).toContain('/worklogs?queue=true&work_type=SERVICES');
  expect(html).toContain('Payroll');
  expect(html).toContain('Services');
  expect(html).toContain('All visible logs');
});

test('Regional Finance is not offered a Payroll list it cannot open', () => {
  mockRoles = ['REGIONAL_FINANCE'];
  const html = renderToStaticMarkup(<ReviewWorkLogs />);
  expect(html).not.toContain('aria-label="Work type queue"');
  expect(html).not.toContain('>Legacy<');
});

test('technical officers retain their actionable queue and both work types', () => {
  mockRoles = ['TECHNICAL_OFFICER'];
  const html = renderToStaticMarkup(<ReviewWorkLogs />);
  expect(useApi.mock.calls.map(([path]) => path)).toContain('/worklogs?queue=true&work_type=SERVICES');
  expect(html).toContain('Payroll');
});

test('finance-only work-log view links monthly reporting and scopes daily review to Services', () => {
  mockRoles = ['REGIONAL_FINANCE'];
  const html = renderToStaticMarkup(<ReviewWorkLogs />);
  expect(useApi.mock.calls.map(([path]) => path)).toContain('/worklogs?queue=true&work_type=SERVICES');
  expect(html).toContain('Monthly work report');
  expect(html).toContain('Payroll is report-only for Finance');
  expect(html).not.toContain('Payroll · approval workflow');
});

const waitingRow = {
  id: 4, staff_name: 'Asha Juma', cadre_code: 'DATA_CLERK', region_name: 'Njombe', facility_name: 'Makambako HC', period_label: 'October 2026',
  status: 'PENDING_RPM_AUTHORIZATION', work_type: 'SERVICES', entry_count: 3, total_hours: 24, hours_in_status: 30, reminder_after_hours: 48, is_overdue: false,
};

test('the review list reads in Swahili, with cadre names, a facility sub-line and headline numbers', () => {
  mockRoles = ['RPM'];
  mockLang = 'sw';
  useApi.mockImplementation((path) => ({ data: path && path.startsWith('/worklogs?') ? [waitingRow] : [], loading: false, error: null, reload: jest.fn() }));
  try {
    const html = renderToStaticMarkup(<ReviewWorkLogs />);
    expect(html).toContain('Zinazonisubiri');
    expect(html).toContain('Zote ninazoweza kuona');
    expect(html).toContain('Pakia upya');
    expect(html).toContain('Mtoa huduma');
    expect(html).toContain('Karani wa Takwimu');
    expect(html).not.toContain('DATA_CLERK');
    expect(html).toContain('Makambako HC');
    expect(html).toContain('Zimesubiri zaidi ya saa 24');
    expect(html).toContain('saa 30');
    expect(html).not.toContain('Waiting on me');
    expect(html).not.toContain('Refresh');
  } finally {
    useApi.mockImplementation(() => ({ data: [], loading: false, error: null, reload: jest.fn() }));
  }
});

test('the approval and payment guide box is no longer shown on the review list', () => {
  mockRoles = ['TECHNICAL_OFFICER'];
  const html = renderToStaticMarkup(<ReviewWorkLogs />);
  expect(html).not.toContain('How Services and Payroll move through approval and payment');
});
