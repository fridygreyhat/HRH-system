/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinanceDownloads } from './FinanceDownloads';

let mockData = {};
jest.mock('../AuthContext', () => ({ useAuth: () => ({ lang: 'en' }) }));
jest.mock('../hooks', () => ({
  useApi: (path) => ({ data: path ? mockData[path.split('?')[0]] ?? null : null, error: null, loading: false, reload: () => {} }),
  useAction: () => ({ busy: false, error: null, run: async (fn) => fn() }),
}));

test('Regional Finance gets Payroll and Services separately, with every download and its formats', () => {
  mockData = { '/finance-pack/options': { work_types: ['PAYROLL', 'SERVICES'], regions: [{ id: 11, name: 'Iringa' }, { id: 22, name: 'Njombe' }],
    cadres: [{ id: 1, name: 'Community Health Worker' }, { id: 3, name: 'Data Clerk' }] } };
  const html = renderToStaticMarkup(<FinanceDownloads />);
  expect(html).toContain('Finance downloads');
  expect(html).toContain('>Payroll</button>');
  expect(html).toContain('>Services</button>');
  for (const text of ['Timesheets', 'Activity totals', 'Payment summary', 'Import file', '>PDF<', '>Excel<', '>CSV<', 'All facilities', 'One person',
    'All cadres', 'Community Health Worker', 'Totals by', '>Facility</option>', '>Region</option>', '>Cadre</option>', '>All providers</option>']) {
    expect(html.includes(text) || html.includes(text.replace('All facilities', 'Choose a region first'))).toBe(true);
  }
});

test('the CSO gets Payroll only, so no work type choice is shown', () => {
  mockData = { '/finance-pack/options': { work_types: ['PAYROLL'], regions: [{ id: 11, name: 'Iringa' }] } };
  const html = renderToStaticMarkup(<FinanceDownloads />);
  expect(html).not.toContain('>Services</button>');
});
