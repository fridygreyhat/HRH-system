/** Registers the offline worker in the built app only (never in development or tests). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installing is optional: the system works the same in a normal browser tab.
    });
  });
}
