/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminAudit } from './AdminAudit';
import { latestReturn, returnFlags } from './worklogs/shared';

let mockRoles = [];
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ hasRole: (...roles) => roles.some(role => mockRoles.includes(role)) }),
}));

test.each(['SUPERVISOR', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'PROVIDER', 'OVERSIGHT'])(
  '%s cannot render audit history', role => {
    mockRoles = [role];
    expect(renderToStaticMarkup(<AdminAudit><p>Audit trail</p></AdminAudit>)).toBe('');
  },
);
test.each(['SUPER_ADMIN', 'SYSTEM_ADMIN', 'CENTRAL_ADMIN'])('%s retains audit history', role => {
  mockRoles = [role];
  expect(renderToStaticMarkup(<AdminAudit><p>Audit trail</p></AdminAudit>)).toContain('Audit trail');
});

test('correction notes and flags remain usable without full audit history', () => {
  const flags = [{ entry_date: '2026-09-01', field: 'hours', note: 'Confirm actual hours' }];
  const log = { status: 'RETURNED_TO_PROVIDER', audit: [], review_feedback: [
    { action: 'return', old_status: 'PENDING_VERIFICATION', new_status: 'RETURNED_TO_PROVIDER',
      comment: 'Correct this entry', details: { flags } },
  ] };
  expect(latestReturn(log).comment).toBe('Correct this entry');
  expect(returnFlags(log)).toEqual(flags);
});
