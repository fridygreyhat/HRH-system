import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.node';
import { ApprovalStepper } from './ApprovalStepper';

jest.mock('../../AuthContext', () => ({
  useAuth: () => ({ lang: 'en', me: { client_settings: { provider_otp_required: false } } }),
}));

test.each(['DRAFT', 'PENDING_RPM_AUTHORIZATION', 'APPROVED'])('Payroll %s has work approvals only', (status) => {
  const html = renderToStaticMarkup(<ApprovalStepper status={status} audit={[]} workflowVersion={2} workType="PAYROLL" />);
  expect(html).toContain('CTC verification');
  expect(html).toContain('Technical review');
  expect(html).toContain('RM authorization');
  expect(html).toContain('Monthly work report');
  expect(html).not.toContain('Regional finance review');
  expect(html).not.toContain('Routed to');
  expect(html).not.toContain('Not yet a payment');
});

test('Services retains finance and payment steps', () => {
  const html = renderToStaticMarkup(<ApprovalStepper status="PENDING_FINANCE_REVIEW" audit={[]} workflowVersion={2} workType="SERVICES" />);
  expect(html).toContain('Regional finance: timesheet');
  expect(html).toContain('Regional finance: Services payment');
  expect(html).toContain('Routed to FHI360');
  expect(html).toContain('Paid');
});

test.each(['SERVICES', 'PAYROLL'])('a %s draft reads as not submitted yet, with nothing waiting on a reviewer', (workType) => {
  const html = renderToStaticMarkup(<ApprovalStepper status="DRAFT" audit={[]} workflowVersion={2} workType={workType} hoursInStatus={7} />);
  expect(html).toContain('Not submitted yet · being filled');
  expect(html).not.toContain('Waiting');
  expect(html).not.toContain('step-current');
});
