import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { PrintBatch, printBatchTarget } from './PrintBatch';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockPath = null;
const period = { id: 1, start_date: '2026-09-26', end_date: '2026-10-25', status: 'OPEN', holidays: [] };
const cadre = { id: 1, code: 'CHW', name: 'Community Health Worker', form_title: 'CHW timesheet', hours_mode: 'DIRECT', fields: [], activities: [], requires_facility_endorsement: false };
const log = (id, name, days) => ({
  id, version: 1, status: 'PENDING_CTC_VERIFICATION', period, cadre, days, hours: days * 6,
  assignment: { region: 'Iringa', facility: 'Ilula HC', community_area: null },
  staff: { id, name, first_name: name, middle_name: null, last_name: 'Test', salary_scale: null },
  entries: days ? [{ id: id * 10, entry_date: '2026-10-01', hours_worked: 6, measures: {}, activity_key: null, comment: null }] : [],
  service_targets: [], audit: [], attested_at: null, occupation: null, occupation_other: null, section: null, period_comment: null,
});
jest.mock('../AuthContext', () => ({ useAuth: () => ({ me: { client_settings: { provider_otp_required: false } } }) }));
jest.mock('../hooks', () => ({
  useApi: (path) => {
    mockPath = path;
    return { data: { month: '2026-10', printed_by: 'CTC In-Charge', logs: [log(1, 'Asha', 1), log(2, 'Baraka', 0)] }, error: null, loading: false, reload: jest.fn() };
  },
}));

function render(target) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<PrintBatch target={target} />));
  return { container, close: () => { act(() => root.unmount()); container.remove(); } };
}

test('the printout asks for the same list the reviewer was looking at', () => {
  const { close } = render(printBatchTarget({ queue: true, work_type: 'PAYROLL', cadre: 'CHW', region_id: '' }));
  try {
    const [path, query] = mockPath.split('?');
    const params = Object.fromEntries(new URLSearchParams(query));
    expect(path).toBe('/worklogs/print');
    expect(params).toEqual({ queue: 'true', work_type: 'PAYROLL', cadre: 'CHW', month: expect.stringMatching(/^\d{4}-\d{2}$/) });
  } finally { close(); }
});

test('a register comes first, then one paper form per provider with days in the month', () => {
  const { container, close } = render(printBatchTarget({ work_type: 'SERVICES' }));
  try {
    const papers = container.querySelectorAll('article.paper');
    expect(papers).toHaveLength(2);
    expect(papers[0].getAttribute('aria-label')).toBe('Timesheet register');
    expect(papers[0].textContent).toContain('Asha');
    expect(papers[0].textContent).not.toContain('Baraka');
    expect(papers[0].textContent).toContain('CTC In-Charge');
    expect(papers[1].textContent).toContain('CHW timesheet');
    act(() => container.querySelector('input[type=checkbox]').click());
    expect(container.querySelectorAll('article.paper')).toHaveLength(3);
  } finally { close(); }
});
