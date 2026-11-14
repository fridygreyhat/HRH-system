import React from 'react';
import { createRoot } from 'react-dom/client';
import { Modal, pageLang } from './ui';

export interface ConfirmOptions {
  /** Short question or action name, e.g. "Delete this day?" */
  title: string;
  /** What happens if they go ahead. Blank lines start a new paragraph. */
  message?: React.ReactNode;
  /** The action itself ("Delete", "Deactivate", "Publish"), never just "OK". */
  confirmLabel: string;
  /** Red button, and Cancel is focused first: for actions that cannot be undone or stop someone working. */
  danger?: boolean;
  cancelLabel?: string;
}

function paragraphs(message: React.ReactNode) {
  if (typeof message !== 'string') return message;
  return message.split(/\n\s*\n/).map((text, i) => <p key={i}>{text.trim()}</p>);
}

function ConfirmDialog({ options, onDone }: { options: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const sw = pageLang() === 'sw';
  const cancel = options.cancelLabel || (sw ? 'Ghairi' : 'Cancel');
  return (
    <Modal title={options.title} onClose={() => onDone(false)}>
      <div className="stack confirm-dialog">
        {options.message && <div className={`confirm-message${options.danger ? ' confirm-danger' : ''}`}>{paragraphs(options.message)}</div>}
        <div className="row confirm-actions">
          <button type="button" className={`btn ${options.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onDone(true)}>
            {options.confirmLabel}
          </button>
          <button type="button" className="btn btn-ghost" data-autofocus={options.danger ? '' : undefined} onClick={() => onDone(false)}>
            {cancel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The app's own "Are you sure?" box, in place of the browser's window.confirm: same look and theme as the rest of
 * the app, in the page language. Resolves true when the action is confirmed; Cancel, Escape, × or a click outside
 * resolve false. Needs no provider: each call renders its own dialog at the end of the page.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.className = 'confirm-host';
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(<ConfirmDialog options={options} onDone={done} />);
  });
}
