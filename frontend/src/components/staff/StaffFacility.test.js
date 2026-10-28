import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { StaffDrawer } from './StaffDrawer';
import { api } from '../../api';

let mockRoles = ['CENTRAL_ADMIN'];
const mockStaff = {
  id: 42, cadre: 'CHW', cadre_id: 1, legal_name: 'Test Worker', first_name: 'Test', last_name: 'Worker',
  verified_phone: '+255700111222', status: 'ACTIVE', employment_start_date: '2026-09-01',
  employment_end_date: null, enrollment_source: 'MANUAL', username: 'test.worker',
  assignments: [{ id: 1, region_id: 7, region: 'Iringa', district_id: 8, district: 'Test district',
    ward_id: 9, ward: 'Test ward', facility_id: 10, facility: 'Original facility',
    start_date: '2026-09-01', end_date: null, is_primary: true }],
};
jest.mock('../../api', () => ({ api: { post: jest.fn(), patch: jest.fn() } }));
jest.mock('../../AuthContext', () => ({
  useAuth: () => ({
    me: { roles: mockRoles, scopes: [] }, lang: 'en', t: key => key,
    hasRole: (...roles) => roles.some(role => mockRoles.includes(role)),
  }),
}));
jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  useApi: path => ({
    data: path === '/staff/42' ? mockStaff
      : path === '/admin/regions' ? [{ id: 7, name: 'Iringa' }]
      : path === '/admin/districts' ? [{ id: 8, name: 'Test district', region_id: 7 }]
      : path === '/admin/wards' ? [{ id: 9, name: 'Test ward', district_id: 8 }] : [],
    error: null, loading: false, reload: jest.fn(), setData: jest.fn(),
  }),
}));

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mockRoles = ['CENTRAL_ADMIN'];
  api.post.mockReset();
  api.patch.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label);
const render = () => root.render(<StaffDrawer staffId={42} cadres={[{ id: 1, code: mockStaff.cadre, uses_section: false }]}
  onClose={() => {}} onChanged={() => {}} />);

test.each(['CHW', 'HCP', 'DATA_CLERK'])('%s has an explicit facility-placement edit with prefilled location', async cadre => {
  mockStaff.cadre = cadre;
  api.post.mockResolvedValue(mockStaff);
  act(render);
  act(() => button('Change facility / placement').click());
  const form = document.querySelector('form');
  const facility = form.querySelector('input[autocomplete="off"]');
  expect(facility.disabled).toBe(false);
  expect(facility.value).toBe('Original facility');
  act(() => {
    Simulate.change(facility, { target: { value: 'New facility' } });
    Simulate.change(form.querySelector('input[type="date"]'), { target: { value: '2026-09-01' } });
    Simulate.change(form.querySelector('textarea'), { target: { value: 'Correct placement' } });
  });
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.post).toHaveBeenCalledWith('/staff/42/rotate', expect.objectContaining({
    effective_date: '2026-09-01', reason: 'Correct placement',
    assignment: expect.objectContaining({ region_id: 7, ward_id: 9, facility_name: 'New facility' }),
  }));
});

test('shared-facility rename warns that all linked staff are affected', async () => {
  api.patch.mockResolvedValue({ id: 10 });
  act(render);
  act(() => button('Edit facility name').click());
  const form = document.querySelector('form');
  expect(form.textContent).toContain('all linked staff');
  act(() => {
    Simulate.change(form.querySelector('input'), { target: { value: 'Corrected name' } });
    Simulate.change(form.querySelector('textarea'), { target: { value: 'Correct spelling' } });
  });
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.patch).toHaveBeenCalledWith('/admin/facilities/10/name', { name: 'Corrected name', reason: 'Correct spelling' });
});

test('CSO Finance cannot transfer providers or rename a shared facility', () => {
  mockRoles = ['CSO_FINANCE'];
  act(render);
  expect(button('Change facility / placement')).toBeUndefined();
  expect(button('Edit facility name')).toBeUndefined();
});
