/** @jest-environment node */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Batches } from './Batches';

let mockReady = { A: 0, B: 0, C: 0 };
let mockRoles = ['FHI360_FINANCE'];
jest.mock('../AuthContext', () => ({ useAuth: () => ({ lang: 'en', hasRole: (...roles) => roles.some((role) => mockRoles.includes(role)) }) }));
jest.mock('../hooks', () => ({
  useApi: (path) => ({ data: path === '/batches/ready' ? mockReady : [], error: null, loading: false, reload: () => {} }),
  useAction: () => ({ busy: false, error: null, run: async (fn) => fn() }),
}));

test('with nothing ready, no batch is offered and the page says where payment happens now', () => {
  mockReady = { A: 0, B: 0, C: 0 };
  const html = renderToStaticMarkup(<Batches />);
  expect(html).not.toMatch(/Create .* batches/);
  expect(html).toContain('Nothing to batch. Services are paid from the payment form, PRF and proof of payment');
  expect(html).toContain('Payroll is paid by the CSO from the signed Payroll report');
});

test('a route with ready claims is offered, with how many', () => {
  mockReady = { A: 3, B: 0, C: 0 };
  const html = renderToStaticMarkup(<Batches />);
  expect(html).toContain("Create FHI360 Payment batches (3 ready)");
  expect(html.match(/ready\)/g)).toHaveLength(1); // Route B, with nothing ready, is not offered
  expect(html).not.toContain('Nothing to batch');
});
