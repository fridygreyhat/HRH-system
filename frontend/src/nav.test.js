import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useHashRoute } from './nav';
import { PAGES } from './App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('budget allocation paths and hashes no longer resolve to an application page', () => {
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
    expect(PAGES.some(page => page.key === 'budgets')).toBe(false);
  } finally {
    act(() => root.unmount());
    window.history.replaceState(null, '', original);
  }
});
