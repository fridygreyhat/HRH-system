/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { servicesDelivered, WorkTypeBanner } from './WorkTypeBanner';

const base = { staff: { salary_scale: 'TGS B' }, totals: { days: 2, hours: 16 }, claims: [], entries: [] };

test('a Payroll timesheet says it is a salary paid by the CSO, with the monthly salary', () => {
  const html = renderToStaticMarkup(<WorkTypeBanner sw={false} log={{ ...base, work_type: 'PAYROLL',
    payroll_pay: { amount_visible: true, month: '2026-10', salary_scale: 'TGS B', monthly_salary: '750000.00', currency: 'TZS' } }} />);
  expect(html).toContain('PAYROLL TIMESHEET');
  expect(html).toContain('paid by the CSO');
  expect(html).toContain('TGS B');
  expect(html).toMatch(/750,000/);
  expect(html).toContain('<dt>Monthly salary</dt>');
  expect(html).toContain('wtb-payroll');
  expect(html).not.toContain('Services delivered');
});

test('a Payroll timesheet without a salary amount says so', () => {
  const html = renderToStaticMarkup(<WorkTypeBanner sw log={{ ...base, work_type: 'PAYROLL', payroll_pay: { amount_visible: true, month: '2026-10', salary_scale: 'TGS B', monthly_salary: null, currency: 'TZS' } }} />);
  expect(html).toContain('JEDWALI LA MSHAHARA');
  expect(html).toContain('Haijawekwa');
});

test('a Services timesheet lists the services delivered and the amount paid by Central Finance', () => {
  const entries = [
    { entry_date: '2026-10-01', activity_key: 'index', activity_snapshot: { label_en: 'Index testing', additional_services: [{ activity: { label_en: 'SNS' } }] } },
    { entry_date: '2026-10-02', activity_key: 'index', activity_snapshot: { label_en: 'Index testing' } },
  ];
  const log = { ...base, work_type: 'SERVICES', entries, financial_preview: { total: '80000', currency: 'TZS', lines: [], exceptions: [] } };
  expect(servicesDelivered(log)).toEqual([{ name: 'Index testing', days: 2 }, { name: 'SNS', days: 1 }]);
  const html = renderToStaticMarkup(<WorkTypeBanner sw={false} log={log} />);
  expect(html).toContain('SERVICES TIMESHEET');
  expect(html).toContain('FHI360 Central Finance');
  expect(html).toContain('Index testing');
  expect(html).toMatch(/80,000/);
  expect(html).toContain('wtb-services');
});

test('older timesheets with no work type get no banner', () => {
  expect(renderToStaticMarkup(<WorkTypeBanner sw={false} log={{ ...base, work_type: 'LEGACY' }} />)).toBe('');
});

test('at the timesheet step the Services amount stays hidden', () => {
  const log = { ...base, work_type: 'SERVICES', financial_preview: { total: '80000', currency: 'TZS', lines: [], exceptions: [] } };
  expect(renderToStaticMarkup(<WorkTypeBanner sw={false} log={log} showAmount={false} />)).not.toMatch(/80,000/);
});

test('CTC, Technical, RM and the provider see a Payroll timesheet without the salary amount', () => {
  const html = renderToStaticMarkup(<WorkTypeBanner sw={false} log={{ ...base, work_type: 'PAYROLL', payroll_pay: { amount_visible: false, salary_scale: 'TGS B' } }} />);
  expect(html).toContain('PAYROLL TIMESHEET');
  expect(html).toContain('TGS B');
  expect(html).not.toContain('<dt>Monthly salary</dt>');
  expect(html).not.toContain('TZS');
});
