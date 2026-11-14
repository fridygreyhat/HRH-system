import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { BulkApproval } from './BulkApproval';
import * as apiModule from '../api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const rows = [
  { work_log_id: 1, provider_name: 'Asha', cadre: 'Community Health Worker', cadre_id: 1, facility: 'Kidamali', step: 'timesheet', amount: '40000', flags: [], clean: true },
  { work_log_id: 2, provider_name: 'Juma', cadre: 'Data Clerk', cadre_id: 3, facility: 'Kidamali', step: 'timesheet', amount: '40000', flags: [], clean: true },
  { work_log_id: 3, provider_name: 'Neema', cadre: 'Data Clerk', cadre_id: 3, facility: 'Kidamali', step: 'timesheet', amount: null, flags: ['No amount: a rate is missing for this work.'], clean: false },
];
jest.mock('../AuthContext', () => ({ useAuth: () => ({ lang: 'en' }) }));
jest.mock('../components/worklogs/WorkLogDrawer', () => ({ WorkLogDrawer: () => null }));
jest.mock('../hooks', () => ({
  useApi: (path) => ({
    data: !path ? null : path.startsWith('/finance/bulk-review') ? { rows, counts: { total: 3, clean: 2, flagged: 1 } }
      : path === '/finance/regions' ? [{ id: 11, name: 'Iringa' }] : path === '/admin/funding-sources' ? [{ id: 5, name: 'EpiC', code: 'EPIC', is_active: true }] : [],
    error: null, loading: false, reload: jest.fn(),
  }),
}));

test('Regional Finance approves all clean Services together; flagged ones are listed for one-by-one review', async () => {
  const post = jest.spyOn(apiModule.api, 'post').mockResolvedValue({ approved: [1, 2], skipped: [] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<BulkApproval initial="SERVICES:2026-10:11" />));
  try {
    expect(container.textContent).toContain('Clean: approve together');
    expect(container.textContent).toContain('Flagged: review one by one (1)');
    expect(container.textContent).toContain('No amount: a rate is missing');
    const selectAll = [...container.querySelectorAll('label')].find((l) => l.textContent.includes('Select all clean (2)')).querySelector('input');
    await act(async () => selectAll.click());
    expect(container.textContent).toContain('2 selected');
    const approve = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Approve 2');
    expect(approve.disabled).toBe(true); // needs the funding source and the confirmation
    const funding = [...container.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.includes('EpiC')));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(funding, '5');
      funding.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const confirm = [...container.querySelectorAll('label')].find((l) => l.textContent.includes('I checked the 2 selected')).querySelector('input');
    await act(async () => confirm.click());
    await act(async () => approve.click());
    expect(post).toHaveBeenCalledWith('/finance/bulk-approve', expect.objectContaining({
      work_type: 'SERVICES', month: '2026-10', region_id: 11, work_log_ids: [1, 2], funding_source_id: 5, review_confirmed: true }));
    expect(container.textContent).toContain('2 approved.');
    expect(container.textContent).toContain('Send month to Central Finance');
  } finally {
    act(() => root.unmount()); container.remove(); post.mockRestore();
  }
});
