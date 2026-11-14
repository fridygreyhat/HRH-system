/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formAmount, PaymentFormView } from './PaymentFormView';

const SERVICES = ['S/N', 'Name', 'Cadre', 'Region', 'Health facility', 'No. of days', 'Total amount', 'Mobile No. for (Mobile Wallet Payment)'];
const PAYROLL = ['S/N', 'Name', 'Cadre', 'Region', 'Health facility', 'Monthly salary', 'No. of days filled', 'Total amount', 'Bank name', 'Account number'];
const cellsOf = (html) => [...html.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

test('amounts read as on the paper form', () => {
  expect(formAmount('150000.00')).toBe('150,000');
  expect(formAmount('1250.50')).toBe('1,250.5');
  expect(formAmount(null)).toBe('');
});

test('the Services summary has name, region, facility, days, total of all services and mobile number', () => {
  const html = renderToStaticMarkup(<PaymentFormView sw={false} form={{
    kind: 'SERVICES', month: '2026-10', activity: 'Services payments - October 2026', venue: 'Iringa and Njombe', columns: SERVICES,
    rows: [{ sn: 1, name: 'Asha Juma', cadre: 'CHW', region: 'Iringa', facility: 'Kidamali', services: 'Index testing', days: 10, subtotal: '400000', total: '400000', currency: 'TZS', mobile: '0700000001' }],
    totals: { TZS: '400000' },
  }} />);
  expect(html).toContain('EpiC PROJECT');
  expect(html).toContain('PAYMENT FORM');
  expect(html).toContain('Services payments - October 2026');
  expect(html).toContain('Venue: Iringa and Njombe');
  expect(cellsOf(html).slice(0, 8)).toEqual(['1', 'Asha Juma', 'CHW', 'Iringa', 'Kidamali', '10', '400,000', '0700000001']);
  expect(cellsOf(html).slice(8)).toEqual(['', 'TOTAL', '', '', '', '', '400,000', '']);
});

test('the Payroll form shows salary and bank, and says what is missing', () => {
  const html = renderToStaticMarkup(<PaymentFormView sw={false} form={{
    kind: 'PAYROLL', month: '2026-10', activity: 'CHW Monthly salary payments - Demo CSO - October 2026', venue: 'Iringa', columns: PAYROLL,
    rows: [
      { sn: 1, name: 'Asha Juma', cadre: 'CHW', region: 'Iringa', facility: 'Kidamali', salary: '750000.00', days: 22, subtotal: '750000.00', total: '750000.00', currency: 'TZS', bank_name: 'NMB', bank_account_number: '•••• 6789', bank_branch: 'Iringa', checks: [] },
      { sn: 2, name: 'Juma Ali', cadre: 'HCP', region: 'Iringa', facility: 'Kidamali', salary: null, days: 20, subtotal: null, total: null, currency: 'TZS', bank_name: '', bank_account_number: '', bank_branch: '', checks: ['Salary amount missing'] },
    ],
    totals: { TZS: '750000.00' },
  }} />);
  const cells = cellsOf(html);
  expect(cells.slice(0, 10)).toEqual(['1', 'Asha Juma', 'CHW', 'Iringa', 'Kidamali', '750,000', '22', '750,000', 'NMB', '•••• 6789']);
  expect(cells.slice(10, 20)).toEqual(['2', 'Juma Ali', 'HCP', 'Iringa', 'Kidamali', 'Missing', '20', '', 'Missing', 'Missing']);
  expect(html).toContain('is-payroll');
});
