import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { ReviewWorkLogs } from './ReviewWorkLogs';
import { useApi } from '../hooks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockRoles = ['RPM'];
jest.mock('../AuthContext', () => ({ useAuth: () => ({ hasRole: (...roles) => roles.some(role => mockRoles.includes(role)) }) }));
jest.mock('../hooks', () => ({ useApi: jest.fn() }));
jest.mock('../components/worklogs/WorkLogDrawer', () => ({ WorkLogDrawer: () => null }));

const row = { id: 1, staff_name: 'Asha', cadre_code: 'CHW', region_name: 'Njombe', facility_name: 'Clinic', status: 'PENDING_RPM_AUTHORIZATION', work_type: 'PAYROLL', entry_count: 1, total_hours: 8, hours_in_status: 1 };
const regionField = container => Array.from(container.querySelectorAll('label')).find(label => label.textContent.startsWith('Region'));

const cadres = [{ code: 'CHW', name: 'Community Health Worker' }, { code: 'HCP', name: 'Health Care Provider' }];

function mount(regions, cadreRows = []) {
  useApi.mockReset();
  useApi.mockImplementation(path => ({
    data: path === '/worklogs/regions' ? regions : path === '/worklogs/cadres' ? cadreRows : path && path.startsWith('/worklogs?') ? [row] : [],
    loading: false, error: null, reload: jest.fn(),
  }));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ReviewWorkLogs />));
  return { container, done: () => { act(() => root.unmount()); container.remove(); } };
}

test('a reviewer with several regions sees a Region column and can filter the waiting list', () => {
  const { container, done } = mount([{ id: 7, name: 'Iringa' }, { id: 8, name: 'Njombe' }]);
  try {
    expect(Array.from(container.querySelectorAll('th')).map(th => th.textContent)).toContain('Region');
    expect(container.querySelector('tr[aria-label^="Open work log 1"]').textContent).toContain('Njombe');
    act(() => Simulate.change(regionField(container).querySelector('select'), { target: { value: '8' } }));
    expect(useApi.mock.calls.map(([path]) => path)).toContain('/worklogs?queue=true&work_type=SERVICES&region_id=8');
  } finally {
    done();
  }
});

test('a reviewer with one region keeps the column but gets no filter', () => {
  const { container, done } = mount([{ id: 7, name: 'Iringa' }]);
  try {
    expect(Array.from(container.querySelectorAll('th')).map(th => th.textContent)).toContain('Region');
    expect(regionField(container)).toBeUndefined();
  } finally {
    done();
  }
});

test('a reviewer can narrow the waiting list to one cadre', () => {
  const { container, done } = mount([{ id: 7, name: 'Iringa' }], cadres);
  try {
    const select = Array.from(container.querySelectorAll('label')).find(label => label.textContent.startsWith('Cadre')).querySelector('select');
    act(() => Simulate.change(select, { target: { value: 'HCP' } }));
    expect(useApi.mock.calls.map(([path]) => path)).toContain('/worklogs?queue=true&work_type=SERVICES&cadre=HCP');
  } finally {
    done();
  }
});

test('Facility In-Charge opens straight on their cadres, read only, with no waiting list', () => {
  mockRoles = ['FACILITY_IN_CHARGE'];
  const { container, done } = mount([{ id: 7, name: 'Iringa' }], cadres);
  try {
    expect(container.textContent).toContain('These are the timesheets of the cadres at your facility');
    expect(container.textContent).not.toContain('Waiting on me (');
    expect(useApi.mock.calls.map(([path]) => path).some(path => path && path.includes('queue=true'))).toBe(false);
    expect(Array.from(container.querySelectorAll('label')).some(label => label.textContent.startsWith('Cadre'))).toBe(true);
  } finally {
    mockRoles = ['RPM'];
    done();
  }
});
