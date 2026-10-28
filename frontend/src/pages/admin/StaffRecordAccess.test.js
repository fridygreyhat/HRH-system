/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffRecordAccess } from './StaffRecordAccess';

function render(roles, overrides = {}) {
  return renderToStaticMarkup(
    <StaffRecordAccess user={{ roles, staff_id: null, is_active: true, ...overrides }}>
      <div>Provider linking form</div>
    </StaffRecordAccess>,
  );
}

test.each(['FHI360_FINANCE', 'CSO_FINANCE', 'SYSTEM_ADMIN', 'TECHNICAL_OFFICER', 'RPM'])(
  '%s does not require staff linking',
  (role) => {
    const html = render([role]);
    expect(html).toContain('Staff record: not required');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Provider linking form');
  },
);

test('providers still receive the required linking form, including dual-role accounts', () => {
  expect(render(['PROVIDER'])).toContain('Provider linking form');
  expect(render(['FHI360_FINANCE', 'PROVIDER'])).toContain('Provider linking form');
  expect(render(['PROVIDER'])).not.toContain('Staff record: not required');
});

test('linked and inactive accounts do not show staff linking', () => {
  expect(render(['PROVIDER'], { staff_id: 1 })).toBe('');
  expect(render(['FHI360_FINANCE'], { is_active: false })).toBe('');
});
