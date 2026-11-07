/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServiceTargets } from '../components/worklogs/ServiceTargets';
import { CreateRate, suggestedDays } from './Rates';

jest.mock('../hooks', () => ({ useAction: () => ({ busy: false, error: null, run: jest.fn(), setError: jest.fn() }), useApi: () => ({ data: [] }) }));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ hasRole: () => true }) }));

const rows = [
  { service: 'Index testing', service_sw: 'Upimaji', min_days: 10, days: 6, left: 4 },
  { service: 'SNS-RNR', service_sw: 'SNS', min_days: 5, days: 5, left: 0 },
  { service: 'Mobile clinic', service_sw: 'Kliniki', min_days: 10, days: 12, left: 0 },
];

test.each([['Index testing outreach', '10'], ['SNS-RNR testing', '5'], ['sns', '5'], ['Mobile clinic', '10'], ['TB contact tracing', ''], ['Reindexing', '']])('%s suggests %s days', (name, days) => {
  expect(suggestedDays(name)).toBe(days);
});

test('the add service form asks for the days, and region must be chosen', () => {
  const html = renderToStaticMarkup(<CreateRate lookups={{ cadres: [], regions: [], templates: [] }} onClose={jest.fn()} onSaved={jest.fn()} />);
  expect(html).toContain('Minimum days per month');
  expect(html).toMatch(/type="number" min="0" max="31"[^>]*required/);
  expect(html).not.toContain('All available regions');
});

test('the progress card shows days, what is left and never overflows past the minimum', () => {
  const html = renderToStaticMarkup(<ServiceTargets rows={rows} lang="en" endDate="2026-11-25" />);
  expect(html).toContain('2 of 3 minimums met');
  expect(html).toContain('6 of 10 days');
  expect(html).toContain('4 more days');
  expect(html).toContain('Minimum met');
  expect(html).toContain('width:60%');
  expect(html).toContain('width:100%');
  expect(html).not.toContain('width:120%');
  expect(html).toContain('25 Nov 2026');
});

test('the card speaks Swahili and is absent when a service has no minimum', () => {
  const html = renderToStaticMarkup(<ServiceTargets rows={rows} lang="sw" />);
  expect(html).toContain('Siku za huduma mwezi huu');
  expect(html).toContain('Bado siku 4');
  expect(renderToStaticMarkup(<ServiceTargets rows={[]} lang="en" />)).toBe('');
});
