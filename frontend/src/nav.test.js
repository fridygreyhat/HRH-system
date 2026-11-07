import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useHashRoute } from './nav';
import { PAGES } from './App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('the restored Budget tab points to monthly regional Services budgets', () => {
  const original = window.location.pathname + window.location.search + window.location.hash;
  window.history.replaceState(null, '', '/budget/allocate');
  const container = document.createElement('div');
  const root = createRoot(container);
  function RouteReadout() {
    const route = useHashRoute();
    return <span>{route.page}:{route.id || ''}</span>;
  }
  try {
    act(() => root.render(<RouteReadout />));
    expect(container.textContent).toBe(':');
    act(() => {
      window.history.replaceState(null, '', '/budget/allocate#/budgets');
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(container.textContent).toBe('budgets:');
    expect(PAGES.find(page => page.key === 'budgets').roles).toEqual(['REGIONAL_FINANCE', 'FHI360_FINANCE', 'SUPER_ADMIN']);
  } finally {
    act(() => root.unmount());
    window.history.replaceState(null, '', original);
  }
});

test('every login lands on Home, and menus only offer pages the role can use', () => {
  const page = (key) => PAGES.find((item) => item.key === key);
  expect(PAGES[0].key).toBe('home');
  ['PROVIDER', 'SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE',
    'COMMUNITY_VERIFIER', 'OVERSIGHT', 'CENTRAL_ADMIN', 'REGIONAL_ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN'].forEach((role) => expect(PAGES[0].roles).toContain(role));
  expect(page('review-cadres').roles).toEqual(['SYSTEM_ADMIN', 'SUPER_ADMIN']);
  expect(page('worklogs').roles).not.toContain('CSO_FINANCE');
  expect(page('worklogs').roles).not.toContain('COMMUNITY_VERIFIER');
});
