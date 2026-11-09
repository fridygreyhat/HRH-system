import { useEffect } from 'react';

/** On phones each table row becomes a card (see "Phone tables" in index.css), so each cell carries its column name. */
const PHONE = '(max-width: 640px)';
const MIN_COLUMNS = 3; // two columns fit a phone as they are

function columnNames(table: HTMLTableElement): string[] {
  const names: string[] = [];
  Array.from(table.tHead?.rows[0]?.cells ?? []).forEach((cell) => {
    for (let i = 0; i < cell.colSpan; i += 1) names.push(cell.textContent?.trim() ?? '');
  });
  return names;
}

export function stackTable(table: HTMLTableElement): void {
  const names = columnNames(table);
  if (names.length < MIN_COLUMNS || table.closest('.paper, .paper-table')) return;
  table.setAttribute('data-stacked', '');
  // display: block drops a table's meaning for screen readers, so the roles are stated.
  table.setAttribute('role', 'table');
  Array.from(table.tHead?.rows ?? []).forEach((row) => {
    row.setAttribute('role', 'row');
    Array.from(row.cells).forEach((cell) => cell.setAttribute('role', 'columnheader'));
  });
  [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])].forEach((section) => {
    Array.from(section.rows).forEach((row) => {
      row.setAttribute('role', 'row');
      let column = 0;
      Array.from(row.cells).forEach((cell) => {
        cell.setAttribute('role', cell.tagName === 'TH' ? 'rowheader' : 'cell');
        cell.setAttribute('data-label', cell.colSpan > 1 ? '' : names[column] ?? '');
        column += cell.colSpan;
      });
    });
  });
}

/** Tables come and go with the data, so this watches the page rather than asking every screen to take part. */
export function useStackedTables(): void {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const phone = window.matchMedia(PHONE);
    let frame = 0;
    const run = () => {
      frame = 0;
      if (phone.matches) document.querySelectorAll('table').forEach(stackTable);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    phone.addEventListener('change', schedule);
    schedule();
    return () => {
      observer.disconnect();
      phone.removeEventListener('change', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
