/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreateRate } from './Rates';
import { PayPeriods } from './PayPeriods';

let mockSuper = true;
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ hasRole: (...roles) => mockSuper ? roles.includes('SUPER_ADMIN') : roles.includes('TECHNICAL_OFFICER') }),
}));
jest.mock('../hooks', () => ({
  useAction: () => ({ busy: false, error: null, run: jest.fn(), setError: jest.fn() }),
  useApi: (path) => ({
    data: path.endsWith('regions') ? [{ id: 1, name: 'Test region' }] : [
      { id: 1, start_date: '2026-09-01', end_date: '2026-09-30', period_label: 'Unused', status: 'OPEN', can_manage: true, can_delete: true },
      { id: 2, start_date: '2026-08-01', end_date: '2026-08-31', period_label: 'Used', status: 'CLOSED', can_manage: true, can_delete: false },
    ],
    loading: false, error: null, reload: jest.fn(),
  }),
}));

test('service amount setup has no Payroll, hourly or per-count payment choices', () => {
  const html = renderToStaticMarkup(<CreateRate lookups={{ cadres: [], regions: [], templates: [] }} onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(html).toContain('Fixed amount per service per day');
  expect(html).toContain('One service per day');
  expect(html).not.toContain('value="PAYROLL"');
  expect(html).not.toContain('value="PER_HOUR"');
  expect(html).not.toContain('value="PER_UNIT"');
});

test('Super Admin sees Delete with used periods protected', () => {
  mockSuper = true;
  const html = renderToStaticMarkup(<PayPeriods />);
  expect(html).toContain('Delete unused period');
  expect(html).toContain('In use: close this period instead');
  expect(html.match(/>Delete<\/button>/g)).toHaveLength(2);
});

test('Technical officers cannot see period Delete', () => {
  mockSuper = false;
  expect(renderToStaticMarkup(<PayPeriods />)).not.toContain('>Delete</button>');
});
