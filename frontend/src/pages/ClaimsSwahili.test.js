import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { Claims } from './Claims';
import { useApi } from '../hooks';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockLang = 'en';
jest.mock('../AuthContext', () => ({
  useAuth: () => ({ lang: mockLang, hasRole: (...wanted) => wanted.includes('FHI360_FINANCE') }),
}));
jest.mock('../hooks', () => ({
  useApi: jest.fn(),
  useAction: jest.fn(() => ({ error: null, busy: false, run: jest.fn() })),
}));
jest.mock('../components/claims/ClaimDrawer', () => ({
  ClaimDrawer: () => null, ComponentsTable: () => null,
}));

function render(lang) {
  mockLang = lang;
  document.documentElement.lang = lang;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Claims />));
  return { container, close: () => { act(() => root.unmount()); container.remove(); } };
}

const texts = (container, selector) => [...container.querySelectorAll(selector)].map(node => node.textContent);

beforeEach(() => {
  useApi.mockImplementation(path => ({
    data: path.startsWith('/claims?') ? [{
      id: 1, staff_name: 'Asha', period_label: 'Oktoba 2026', work_type: 'SERVICES', status: 'APPROVED', payment_status: 'PROOF_REQUIRED',
      amount: 40000, amount_paid: 0, currency: 'TZS', category_name: 'Huduma A',
    }] : [],
    error: null, loading: false, reload: jest.fn(),
  }));
});

afterEach(() => { document.documentElement.lang = ''; });

test('Claims renders Kiswahili headings and statuses when lang is sw', () => {
  const { container, close } = render('sw');
  try {
    expect(container.querySelector('h1').textContent).toBe('Madai ya malipo');
    expect(texts(container, 'th')).toEqual(expect.arrayContaining(['Mtumishi', 'Hali ya dai', 'Hali ya malipo', 'Kiasi']));
    expect(texts(container, '.badge')).toEqual(expect.arrayContaining([' Imeidhinishwa', ' Inahitaji uthibitisho']));
    expect(container.querySelector('summary strong').textContent).toBe('Jinsi Huduma na Payroll zinavyopita kwenye idhini na malipo');
    expect(container.textContent).toContain('Hakuna njia ya malipo');
    expect(container.textContent).not.toContain('Payment claims');
    expect(container.textContent).not.toContain('No payment route');
  } finally { close(); }
});

test('Claims keeps the English headings and statuses when lang is en', () => {
  const { container, close } = render('en');
  try {
    expect(container.querySelector('h1').textContent).toBe('Payment claims');
    expect(texts(container, 'th')).toEqual(expect.arrayContaining(['Staff', 'Claim status', 'Payment status', 'Amount']));
    expect(texts(container, '.badge')).toEqual(expect.arrayContaining([' Approved', ' Proof required']));
    expect(container.querySelector('summary strong').textContent).toBe('How Services and Payroll move through approval and payment');
    expect(container.textContent).toContain('No payment route');
    expect(container.textContent).not.toContain('Madai ya malipo');
  } finally { close(); }
});
