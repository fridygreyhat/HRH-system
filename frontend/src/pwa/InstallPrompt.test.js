import React from 'react';
import { createRoot } from 'react-dom/client';
import { act, Simulate } from 'react-dom/test-utils';
import { captureInstallOffer, InstallBar } from './InstallPrompt';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.matchMedia = () => ({ matches: true }); // a phone
  captureInstallOffer();
});
beforeEach(() => localStorage.clear());

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<InstallBar />));
  return { container, done: () => { act(() => root.unmount()); container.remove(); } };
}

function browserOffers() {
  const event = new Event('beforeinstallprompt');
  event.prompt = jest.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted' });
  act(() => window.dispatchEvent(event));
  return event;
}

test('the browser offer made before Home opens is kept, and shown as one slim bar in the page', () => {
  browserOffers();
  const { container, done } = mount();
  const bar = container.querySelector('.install-bar');
  expect(bar).not.toBeNull();
  expect(bar.getAttribute('role')).toBe('region'); // part of the page, not a floating dialog
  expect(bar.textContent).toContain('Add to this phone');
  done();
});

test('"Later" hides it for 30 days', () => {
  browserOffers();
  const { container, done } = mount();
  act(() => Simulate.click(Array.from(container.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Later')));
  expect(container.querySelector('.install-bar')).toBeNull();
  const at = Number(localStorage.getItem('hrh_install_dismissed'));
  localStorage.setItem('hrh_install_dismissed', String(at - 29 * 24 * 3600 * 1000));
  const again = mount();
  expect(again.container.querySelector('.install-bar')).toBeNull(); // day 29: still quiet
  again.done();
  localStorage.setItem('hrh_install_dismissed', String(at - 31 * 24 * 3600 * 1000));
  const later = mount();
  expect(later.container.querySelector('.install-bar')).not.toBeNull(); // day 31: offered again
  later.done();
  done();
});

test('nothing shows once the app is installed', () => {
  browserOffers();
  act(() => window.dispatchEvent(new Event('appinstalled')));
  const { container, done } = mount();
  expect(container.querySelector('.install-bar')).toBeNull();
  done();
});
