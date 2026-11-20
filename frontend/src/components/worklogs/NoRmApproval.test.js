import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.node';
import { ApprovalStepper, MiniStepper } from './ApprovalStepper';

// RM approval switched off: the technical review is the last approval before Regional Finance or the monthly report.
jest.mock('../../AuthContext', () => ({
  useAuth: () => ({ lang: 'en', me: { client_settings: { provider_otp_required: false, rm_approval_required: false } } }),
}));

const row = (action, id) => ({ id, action, actor_name: `${action} person`, timestamp: '2026-11-20T09:00:00Z' });

test.each(['DRAFT', 'PENDING_TECHNICAL_REVIEW', 'APPROVED'])('Payroll %s has no RM step', (status) => {
  const html = renderToStaticMarkup(<ApprovalStepper status={status} audit={[]} workflowVersion={2} workType="PAYROLL" />);
  expect(html).toContain('Technical review');
  expect(html).not.toContain('RM authorization');
  expect(html).toContain('Monthly work report');
});

test('Payroll at technical review is step 3 of 4, and approved reads as complete', () => {
  expect(renderToStaticMarkup(<ApprovalStepper status="PENDING_TECHNICAL_REVIEW" audit={[]} workflowVersion={2} workType="PAYROLL" />))
    .toContain('Step 3 of 4');
  const approved = renderToStaticMarkup(<ApprovalStepper status="APPROVED" audit={[row('submit', 1), row('verify', 2), row('endorse', 3)]} workflowVersion={2} workType="PAYROLL" />);
  expect(approved).toContain('All steps complete');
  expect(approved.match(/step-done/g)).toHaveLength(4);
});

test('Services go from technical review to Regional Finance', () => {
  const html = renderToStaticMarkup(<ApprovalStepper status="PENDING_FINANCE_REVIEW" audit={[]} workflowVersion={2} workType="SERVICES" />);
  expect(html).not.toContain('RM authorization');
  expect(html).toContain('Step 4 of 7 · Now: Regional finance: timesheet');
});

test('a record still with the RM, or one the RM approved, keeps its RM step', () => {
  expect(renderToStaticMarkup(<ApprovalStepper status="PENDING_RPM_AUTHORIZATION" audit={[]} workflowVersion={2} workType="PAYROLL" />))
    .toContain('RM authorization');
  const approved = renderToStaticMarkup(<ApprovalStepper status="APPROVED" audit={[row('submit', 1), row('verify', 2), row('endorse', 3), row('authorize', 4)]} workflowVersion={2} workType="PAYROLL" />);
  expect(approved).toContain('RM authorization');
  expect(approved).toContain('authorize person');
});

test('list rows show one dot for each step and the end', () => {
  expect(renderToStaticMarkup(<MiniStepper status="PENDING_TECHNICAL_REVIEW" />).match(/mini-dot/g)).toHaveLength(4);
  expect(renderToStaticMarkup(<MiniStepper status="PENDING_RPM_AUTHORIZATION" />).match(/mini-dot/g)).toHaveLength(5);
});

