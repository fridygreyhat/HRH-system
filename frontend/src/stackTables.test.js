import { stackTable } from './stackTables';

function table(html, wrapperClass) {
  const wrapper = document.createElement('div');
  wrapper.className = wrapperClass || '';
  wrapper.innerHTML = `<table>${html}</table>`;
  return wrapper.querySelector('table');
}

test('each cell is labelled with its column', () => {
  const t = table('<thead><tr><th>Name</th><th>Region</th><th>Amount</th></tr></thead><tbody><tr><td>A</td><td>B</td><td>C</td></tr></tbody>');
  stackTable(t);
  expect(t.hasAttribute('data-stacked')).toBe(true);
  expect(Array.from(t.querySelectorAll('td')).map((cell) => cell.dataset.label)).toEqual(['Name', 'Region', 'Amount']);
  expect(t.querySelector('td').getAttribute('role')).toBe('cell');
});

test('a wide header and a wide cell keep the following columns lined up', () => {
  const t = table('<thead><tr><th colspan="2">Who</th><th>Amount</th></tr></thead><tbody><tr><td colspan="2">Total</td><td>5</td></tr><tr><td colspan="3">Nothing yet</td></tr></tbody>');
  stackTable(t);
  expect(Array.from(t.querySelectorAll('td')).map((cell) => cell.dataset.label)).toEqual(['', 'Amount', '']);
});

test('narrow tables and printed forms stay as they are', () => {
  const narrow = table('<thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody>');
  const printed = table('<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody>', 'paper-table');
  stackTable(narrow);
  stackTable(printed);
  expect(narrow.hasAttribute('data-stacked')).toBe(false);
  expect(printed.hasAttribute('data-stacked')).toBe(false);
});
