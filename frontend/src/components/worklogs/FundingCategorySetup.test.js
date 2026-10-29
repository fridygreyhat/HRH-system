/** @jest-environment jsdom */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { api } from '../../api';
import { FundingCategorySetup } from './FundingCategorySetup';

jest.mock('../../api', () => ({
  api: { put: jest.fn() },
}));

const unconfiguredCategory = {
  id: 19,
  name: 'fhi360',
  form_type: 'CHW_PNP',
  route_id: null,
  funding_source_id: null,
  payor_org_id: null,
  budget_owner: 'PAYOR',
  origin_channel: 'FACILITY',
  budget_line_code: null,
  requires_work_log: true,
  is_active: true,
};

function mount(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <FundingCategorySetup
        categories={[unconfiguredCategory]}
        fundingSourceId="42"
        canConfigure
        showContactHint={false}
        onSaved={() => {}}
        {...props}
      />,
    );
  });
  return {
    container,
    unmount: () => act(() => root.unmount()),
  };
}

function changeValue(element, value) {
  act(() => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function clickButton(container, label) {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.click());
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('FHI finance user can confirm and save a mapping using the selected source ID', async () => {
  const updated = { ...unconfiguredCategory, funding_source_id: 42 };
  api.put.mockResolvedValue(updated);
  const onSaved = jest.fn();
  const view = mount({ onSaved });

  changeValue(view.container.querySelector('select'), '19');
  changeValue(view.container.querySelector('input'), 'Initial programme assignment');
  clickButton(view.container, 'Review initial assignment');
  expect(view.container.textContent).toContain('affects other new claims');
  expect(view.container.textContent).toContain('does not allocate funds');

  await act(async () => {
    clickButton(view.container, 'Confirm and link category');
    await Promise.resolve();
  });

  expect(api.put).toHaveBeenCalledWith('/finance/categories/19/funding-source', {
    funding_source_id: 42,
    reason: 'Initial programme assignment',
  });
  expect(onSaved).toHaveBeenCalledWith(updated);
  view.unmount();
});

test('cancel closes confirmation without writing a mapping', () => {
  const view = mount();
  changeValue(view.container.querySelector('select'), '19');
  changeValue(view.container.querySelector('input'), 'Use selected programme');
  clickButton(view.container, 'Review initial assignment');
  clickButton(view.container, 'Cancel');
  expect(view.container.textContent).not.toContain('Confirm and link category');
  expect(api.put).not.toHaveBeenCalled();
  view.unmount();
});

test('unprivileged users get a Central Finance hint but no mapping controls', () => {
  const view = mount({ canConfigure: false, showContactHint: true });
  expect(view.container.textContent).toContain('Contact Central Finance');
  expect(view.container.querySelector('select')).toBeNull();
  view.unmount();
});

test('mapping errors are shown and leave confirmation available for correction', async () => {
  api.put.mockRejectedValue(new Error('Category has live claims and cannot be changed.'));
  const view = mount();
  changeValue(view.container.querySelector('select'), '19');
  changeValue(view.container.querySelector('input'), 'Initial assignment');
  clickButton(view.container, 'Review initial assignment');

  await act(async () => {
    clickButton(view.container, 'Confirm and link category');
    await Promise.resolve();
  });

  expect(view.container.textContent).toContain('Category has live claims and cannot be changed.');
  expect(view.container.textContent).toContain('Confirm and link category');
  view.unmount();
});
