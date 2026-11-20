/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentBadge } from './SalaryTimesheets';

test.each([
  [{ payment_status: 'PAID', paid_amount: '150000.00' }, 'Paid', 'badge-success'],
  [{ payment_status: 'PART_PAID', paid_amount: '100000.00' }, 'Part paid', 'badge-warn'],
  [{ payment_status: 'NOT_PAID', paid_amount: '0' }, 'Not paid yet', 'badge-neutral'],
])('each provider on the received list shows its payment: %j', (row, text, tone) => {
  const html = renderToStaticMarkup(<PaymentBadge row={row} sw={false} />);
  expect(html).toContain(text);
  expect(html).toContain(tone);
});

test('in Swahili', () => {
  expect(renderToStaticMarkup(<PaymentBadge row={{ payment_status: 'PAID' }} sw />)).toContain('Imelipwa');
});
