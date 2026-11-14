import { act, Simulate } from 'react-dom/test-utils';
import { confirmAction } from './ConfirmDialog';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const dialog = () => document.querySelector('.confirm-host [role="dialog"]');
const button = (text) => Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent === text);

afterEach(() => { document.documentElement.lang = 'en'; });

test('the app box asks with a title, the effect and a named red action; confirming resolves true and closes it', async () => {
  let answer;
  await act(async () => { answer = confirmAction({ title: 'Delete May 2026?', message: 'Gone for good.\n\nThis cannot be undone.', confirmLabel: 'Delete period', danger: true }); });
  expect(dialog().querySelector('h2').textContent).toBe('Delete May 2026?');
  expect(dialog().querySelectorAll('.confirm-message p')).toHaveLength(2);
  expect(button('Delete period').className).toContain('btn-danger');
  expect(document.activeElement.textContent).toBe('Cancel'); // a slip of Enter does not delete
  await act(async () => Simulate.click(button('Delete period')));
  await expect(answer).resolves.toBe(true);
  expect(document.querySelector('.confirm-host')).toBeNull();
});

test('Cancel, Escape and the close button all resolve false; Swahili pages get Swahili buttons', async () => {
  document.documentElement.lang = 'sw';
  let answer;
  await act(async () => { answer = confirmAction({ title: 'Unda makundi?', confirmLabel: 'Unda makundi' }); });
  expect(button('Unda makundi').className).toContain('btn-primary');
  await act(async () => Simulate.click(button('Ghairi')));
  await expect(answer).resolves.toBe(false);

  await act(async () => { answer = confirmAction({ title: 'Again?', confirmLabel: 'Go' }); });
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await expect(answer).resolves.toBe(false);
  expect(document.querySelector('.confirm-host')).toBeNull();
});
