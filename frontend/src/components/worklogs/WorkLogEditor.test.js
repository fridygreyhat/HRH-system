import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HeaderForm } from './WorkLogEditor';
import { api } from '../../api';

jest.mock('../../AuthContext', () => ({ useAuth: () => ({ t: key => key, lang: 'en' }) }));
jest.mock('../../api', () => ({ api: { put: jest.fn() } }));
jest.mock('../../hooks', () => ({
  ...jest.requireActual('../../hooks'),
  useApi: () => ({ data: [], error: null, loading: false }),
}));

test('Data Clerk header has no period-comment input and does not overwrite historic comments', async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const log = {
    id: 7, can_edit: true, period_comment: 'Historic period comment',
    cadre: { code: 'DATA_CLERK', uses_section: false, occupation_options: [] },
  };
  const onSaved = jest.fn();
  api.put.mockResolvedValue(log);
  try {
    act(() => root.render(<HeaderForm log={log} onSaved={onSaved} />));
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toContain('periodComment');
    await act(async () => container.querySelector('form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ));
    expect(api.put).toHaveBeenCalledWith('/worklogs/7', {});
    expect(api.put.mock.calls[0][1]).not.toHaveProperty('period_comment');
    expect(onSaved).toHaveBeenCalledWith(log);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
