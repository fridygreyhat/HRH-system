import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.node';
import { PaymentSetupNotice } from './PaymentSetupNotice';

test('groups missing amounts by service and removes duplicate consequences', () => {
  const html = renderToStaticMarkup(<PaymentSetupNotice exceptions={[
    '2026-10-01: Special and Weekend Clinics has no configured daily amount.',
    '2026-10-02: Special and Weekend Clinics has no configured activity rate.',
    '2026-10-01: TB Contact tracing has no configured daily amount.',
    'No priced activity entries are available.',
    'The validated payment amount must be greater than zero.',
  ]} />);
  expect(html).toContain('Payment setup required');
  expect(html).toContain('RM can approve the work');
  expect(html.match(/Special and Weekend Clinics/g)).toHaveLength(1);
  expect(html).toContain('2026-10-01, 2026-10-02');
  expect(html).toContain('TB Contact tracing');
  expect(html).not.toContain('No priced activity entries');
  expect(html).not.toContain('greater than zero');
});

test('retains independent financial safety errors', () => {
  const html = renderToStaticMarkup(<PaymentSetupNotice exceptions={[
    'The validated payment amount must be greater than zero.',
    'A finance-reviewed work log must use one currency.',
  ]} />);
  expect(html).toContain('greater than zero');
  expect(html).toContain('one currency');
});

test('does not render a warning when payment setup is complete', () => {
  expect(renderToStaticMarkup(<PaymentSetupNotice exceptions={[]} />)).toBe('');
});
