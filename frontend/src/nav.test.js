import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { canOpenBudgetAllocation, isBudgetAllocationEntry, useHashRoute } from './nav';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('budget allocation deep entry is recognized only for its exact hash route', () => {
  expect(isBudgetAllocationEntry({ page: 'budget', id: 'allocate' })).toBe(true);
  expect(isBudgetAllocationEntry({ page: 'budgets', id: null })).toBe(false);
  expect(isBudgetAllocationEntry({ page: 'budget', id: null })).toBe(false);
});

test('direct allocation path opens its route while hash navigation takes priority', () => {
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
    expect(container.textContent).toBe('budget:allocate');
    act(() => {
      window.history.replaceState(null, '', '/budget/allocate#/budgets');
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(container.textContent).toBe('budgets:');
  } finally {
    act(() => root.unmount());
    window.history.replaceState(null, '', original);
  }
});

test('budget creator deep entry access is limited to finance roles', () => {
  expect(canOpenBudgetAllocation(['CSO_FINANCE'])).toBe(true);
  expect(canOpenBudgetAllocation(['FHI360_FINANCE'])).toBe(true);
  expect(canOpenBudgetAllocation(['RPM', 'OVERSIGHT'])).toBe(false);
  expect(canOpenBudgetAllocation(['PROVIDER'])).toBe(false);
});
