import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { RosterImport } from './RosterImport';
import { api, saveBlob } from '../../api';

jest.mock('../../api', () => ({ api: { blob: jest.fn(), upload: jest.fn() }, saveBlob: jest.fn() }));
jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  useApi: path => ({
    data: path === '/staff/import-template' ? { columns: ['first_name', 'phone'], required: ['first_name', 'phone'] } : [],
    error: null, loading: false, reload: jest.fn(),
  }),
}));

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = label => [...container.querySelectorAll('button')].find(b => b.textContent === label);

test('the Excel template downloads with the signed-in session and is saved under its name', async () => {
  const file = { blob: new Blob(['x']), filename: 'hrh-roster-template.xlsx' };
  api.blob.mockResolvedValue(file);
  act(() => root.render(<RosterImport />));
  await act(async () => Simulate.click(button('Download Excel template')));
  expect(api.blob).toHaveBeenCalledWith('/staff/import-template.xlsx', 'GET', 'hrh-roster-template.xlsx');
  expect(saveBlob).toHaveBeenCalledWith(file);
});

test('a failed download says why, and the upload accepts the Excel workbook as well as CSV', async () => {
  api.blob.mockRejectedValue(new Error('Cannot reach the server. Check your connection and try again.'));
  act(() => root.render(<RosterImport />));
  await act(async () => Simulate.click(button('Download Excel template')));
  expect(container.textContent).toContain('Cannot reach the server');
  expect(saveBlob).not.toHaveBeenCalled();
  expect(container.querySelector('input[type="file"]').accept.split(',')).toEqual(expect.arrayContaining(['.xlsx', '.csv']));
});
