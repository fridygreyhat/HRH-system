import { grouped, remaining, totalsByCurrency } from './Budgets';

const line = (id, currency, allocated, committed, spent, org = 'CSO', region = 'Mara', organizationId = 2) => ({
  id, currency, allocated_amount: allocated, committed_amount: committed, spent_amount: spent,
  available_amount: 999999, organization_name: org, region_name: region, category_name: 'Services',
  organization_id: organizationId, region_id: 7, category_id: 4, period_label: 'January', period_id: 1,
});

test('hierarchy groups lines at each organization, region, category, and pay-period boundary', () => {
  const rows = [line(1, 'TZS', 100, 20, 10), line(2, 'TZS', 60, 5, 15, 'Upendo', 'Mara', 3)];
  const orgs = grouped(rows, row => String(row.organization_id), row => row.organization_name);
  expect(orgs).toHaveLength(2);
  const regions = grouped(orgs[0].lines, row => String(row.region_id), row => row.region_name);
  const categories = grouped(regions[0].lines, row => String(row.category_id), row => row.category_name);
  const periods = grouped(categories[0].lines, row => String(row.period_id), row => row.period_label);
  expect(periods[0].lines.map(row => row.id)).toEqual([1]);
});

test('remaining is allocation less committed and spent; totals stay separated by currency', () => {
  const rows = [line(1, 'TZS', 100, 20, 10), line(2, 'USD', 40, 5, 3)];
  expect(remaining(rows[0])).toBe(70);
  expect(totalsByCurrency(rows).map(total => [total.currency, total.available])).toEqual([['TZS', 70], ['USD', 32]]);
});
