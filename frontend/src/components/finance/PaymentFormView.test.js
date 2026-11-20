/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formAmount, PaymentFormView } from './PaymentFormView';

const SERVICES = ['S/N', 'Name', 'Cadre', 'Region', 'Health facility', 'No. of days', 'Services summary', 'Total amount', 'Mobile No. for (Mobile Wallet Payment)'];
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
    rows: [{ sn: 1, name: 'Asha Juma', cadre: 'CHW', region: 'Iringa', facility: 'Kidamali', services: 'Index testing', summary: 'Index testing outreach (10 days)', days: 10, subtotal: '400000', total: '400000', currency: 'TZS', mobile: '0700000001' }],
    totals: { TZS: '400000' },
  }} />);
  expect(html).toContain('EpiC PROJECT');
  expect(html).toContain('PAYMENT FORM');
  expect(html).toContain('Services payments - October 2026');
  expect(html).toContain('Venue: Iringa and Njombe');
  expect(cellsOf(html).slice(0, 9)).toEqual(['1', 'Asha Juma', 'CHW', 'Iringa', 'Kidamali', '10', 'Index testing outreach (10 days)', '400,000', '0700000001']);
  expect(cellsOf(html).slice(9)).toEqual(['', '10', '', '400,000', '']);  // the total row: its days and amount
  expect(html).toContain('TOTAL (1 person)');
  expect(html).not.toContain('Subtotal');  // one facility: no subtotals
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

test('a long Services summary shows one service per line with its days', () => {
  const lines = [['Index testing outreach', 4], ['SNS-RNR testing outreach', 3], ['TB contact tracing', 2], ['Special and weekend clinics', 2],
    ['Community TB active case finding', 1], ['Outreach services', 1], ['Weekend clinic data entry', 1]];
  const form = {
    kind: 'SERVICES', month: '2026-10', activity: 'Services payments - October 2026', venue: 'Njombe', columns: SERVICES, totals: { TZS: '140000' },
    rows: [{ sn: 1, name: 'Janeth Mandepu', cadre: 'Health Care Provider', region: 'Njombe', facility: 'Kifanya Dispensary', days: 14,
      summary: lines.map(([s, d]) => `${s} (${d} ${d === 1 ? 'day' : 'days'})`).join('\n'), summary_lines: lines,
      subtotal: '140000', total: '140000', currency: 'TZS', mobile: '+255710000003' }],
  };
  const html = renderToStaticMarkup(<PaymentFormView form={form} />);
  const items = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').trim().replace(/\s+/g, ' '));
  expect(items).toHaveLength(7);
  expect(items[0]).toBe('Index testing outreach 4 days');
  expect(items[6]).toBe('Weekend clinic data entry 1 day');
});

test('many facilities: a summary by facility, then a subtotal after each one', () => {
  const row = (sn, facility, days) => ({ sn, name: `Person ${sn}`, cadre: 'CHW', region: 'Njombe', facility, days, subtotal: String(days * 20000),
    total: String(days * 20000), currency: 'TZS', mobile: '0700', summary_lines: [['Outreach services', days]] });
  const form = { kind: 'SERVICES', month: '2026-10', activity: 'Services payments - October 2026', venue: 'Njombe', columns: SERVICES,
    rows: [row(1, 'Kifanya Dispensary', 3), row(2, 'Kifanya Dispensary', 2), row(3, 'Ihanga Dispensary', 4)], totals: { TZS: '180000' } };
  const html = renderToStaticMarkup(<PaymentFormView form={form} />);
  expect(html).toContain('Summary by health facility');
  expect(html).toContain('Subtotal: Kifanya Dispensary, Njombe (2 people)');
  expect(html).toContain('Subtotal: Ihanga Dispensary, Njombe (1 person)');
  expect(html).toContain('TOTAL (3 people)');
  expect(html.indexOf('Subtotal: Kifanya')).toBeLessThan(html.indexOf('Person 3'));
});
