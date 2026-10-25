import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { StaffDrawer } from './StaffDrawer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const limitedStaffProfile = {
  id: 42,
  user_id: 84,
  cadre_id: 3,
  cadre: 'HCP',
  first_name: 'Asha',
  middle_name: null,
  last_name: 'Mushi',
  legal_name: 'Asha Mushi',
  verified_phone: '+255712345678',
  occupation: null,
  occupation_other: null,
  salary_scale: null,
  status: 'ACTIVE',
  employment_start_date: null,
  employment_end_date: null,
  enrollment_source: 'ROSTER',
  bank_name: 'Mlimani Bank',
  bank_account_number: '123456789012',
  bank_branch: 'Mwanza',
  payment_method: 'BANK',
  payment_provider: 'Legacy bank provider',
  payment_account: 'LEGACY_PROFILE_ACCOUNT',
  assignments: [],
  username: 'asha',
};

jest.mock('../../AuthContext', () => ({
  useAuth: () => ({ hasRole: (...roles) => roles.includes('CSO_FINANCE') }),
}));
jest.mock('../../hooks', () => ({
  useApi: (path) => ({
    data: path === '/staff/42' ? limitedStaffProfile : [],
    error: null,
    loading: false,
    reload: jest.fn(),
    setData: jest.fn(),
  }),
}));
jest.mock('./StaffForms', () => ({
  EditStaffModal: () => null,
  ExitDialog: () => null,
  LoginModal: () => null,
  RotateModal: () => null,
}));

test('CSO staff detail displays only returned bank profile fields and never invents a hidden mobile counterpart', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<StaffDrawer staffId={42} cadres={[]} onClose={jest.fn()} onChanged={jest.fn()} />));
  try {
    expect(container.textContent).toContain('Payroll · bank account');
    expect(container.textContent).toContain('Mlimani Bank');
    expect(container.textContent).toContain('123456789012');
    expect(container.textContent).toContain('Mwanza');
    expect(container.textContent).not.toContain('Services · mobile money');
    expect(container.textContent).not.toContain('Mobile money number');
    expect(container.textContent).not.toContain('LEGACY_PROFILE_ACCOUNT');
    expect(container.textContent).not.toContain('Legacy bank provider');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
