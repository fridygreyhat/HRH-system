import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ReviewWorkLogs } from './ReviewWorkLogs';
import { useApi } from '../hooks';

let mockRole;
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ hasRole: (...roles) => roles.includes(mockRole) }),
}));
jest.mock('../hooks', () => ({
  useApi: jest.fn(() => ({ data: [], loading: false, error: null, reload: jest.fn() })),
}));
jest.mock('../components/worklogs/WorkLogDrawer', () => ({ WorkLogDrawer: () => null }));

test.each(['SUPERVISOR', 'TECHNICAL_OFFICER', 'RPM'])('%s switches between distinct Services and Payroll requests', role => {
  mockRole = role;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
  try {
    act(() => root.render(<ReviewWorkLogs />));
    expect(useApi.mock.calls.some(([path]) => path?.includes('work_type=SERVICES'))).toBe(true);
    expect(container.textContent).toContain('Approving one does not approve the other');
    act(() => button('Payroll').click());
    const paths = useApi.mock.calls.map(([path]) => path).filter(path => path?.startsWith('/worklogs'));
    expect(paths.at(-1)).toContain('work_type=PAYROLL');
    act(() => button('Services').click());
    expect(useApi.mock.calls.map(([path]) => path).filter(path => path?.startsWith('/worklogs')).at(-1)).toContain('work_type=SERVICES');
    if (role === 'RPM') {
      act(() => [...container.querySelectorAll('button')].find(node => node.textContent.startsWith('Waiting on me')).click());
      expect(useApi.mock.calls.map(([path]) => path).filter(path => path?.startsWith('/worklogs')).at(-1)).toBe('/worklogs?queue=true&work_type=SERVICES');
    }
  } finally { act(() => root.unmount()); container.remove(); useApi.mockClear(); }
});
