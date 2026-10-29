import {
  canRouteReviewedFinanceContext,
  buildServiceFinanceReviewPayload,
  canSubmitServiceFinanceReview,
  reviewedFinanceContextChanged,
  selectionAfterFundingSourceChange,
  serviceCategoriesForSource,
  supportedServiceFundingSources,
  unconfiguredServiceCategories,
} from './FundingReview';

const category = (id, sourceId, overrides = {}) => ({
  id,
  name: `Category ${id}`,
  form_type: 'SERVICES',
  origin_channel: 'FACILITY',
  route_id: null,
  funding_source_id: sourceId,
  payor_org_id: null,
  budget_owner: 'PAYOR',
  origin_channel: 'FACILITY',
  budget_line_code: null,
  requires_work_log: true,
  is_active: true,
  ...overrides,
});

test('filters to active, non-Payroll categories configured for the selected source', () => {
  const rows = [
    category(1, 10),
    category(2, 20),
    category(3, 10, { is_active: false }),
    category(4, 10, { form_type: 'PAYROLL' }),
    category(5, 10, { form_type: 'SALARY' }),
  ];

  expect(serviceCategoriesForSource(rows, '10').map((row) => row.id)).toEqual([1]);
  expect(serviceCategoriesForSource(rows, '').map((row) => row.id)).toEqual([]);
});

test('changing funding source clears the previously selected category', () => {
  expect(selectionAfterFundingSourceChange('20')).toEqual({ fundingSourceId: '20', categoryId: '' });
});

test('missing configured choices produce no selectable categories', () => {
  expect(serviceCategoriesForSource([], '10')).toEqual([]);
});

test('funding filters exclude payroll-like forms and community-origin categories', () => {
  const rows = [
    category(1, 10, { form_type: 'STIPEND' }),
    category(2, 10, { form_type: 'STIPENDS' }),
    category(3, 10, { form_type: 'TIMESHEET' }),
    category(4, 10, { origin_channel: 'COMMUNITY' }),
    category(5, null),
  ];

  expect(serviceCategoriesForSource(rows, '10')).toEqual([]);
  expect(unconfiguredServiceCategories(rows).map((row) => row.id)).toEqual([5]);
});

test('a changed reviewed source or category prevents routing until re-review', () => {
  expect(reviewedFinanceContextChanged('20', '1', '10', '1')).toBe(true);
  expect(canRouteReviewedFinanceContext(true)).toBe(false);
  expect(reviewedFinanceContextChanged('10', '1', '10', '1')).toBe(false);
  expect(canRouteReviewedFinanceContext(false)).toBe(true);
});

test('Services finance review accepts only PnP, Supply Chain and EpiC and sends source without category', () => {
  const sources = [
    { id: 11, code: 'PNP', name: 'PnP' },
    { id: 12, code: 'SUPPLY_CHAIN', name: 'Supply Chain' },
    { id: 13, code: 'EPIC', name: 'EpiC' },
    { id: 14, code: 'OTHER', name: 'Other programme' },
  ];
  const choices = supportedServiceFundingSources(sources);
  expect(choices.map(source => source.id)).toEqual([11, 12, 13]);
  const payload = buildServiceFinanceReviewPayload({
    review_confirmed: true,
    review_type: 'SERVICES',
    expected_version: 7,
    expected_review_token: 'review-abc',
  }, '12');
  expect(payload).toEqual({
    review_confirmed: true,
    review_type: 'SERVICES',
    expected_version: 7,
    expected_review_token: 'review-abc',
    funding_source_id: 12,
  });
  expect(payload).not.toHaveProperty('category_id');
});

test('Services finance review is gated on source selection and completed explicit review', () => {
  const sources = [{ id: 11, code: 'PNP', name: 'PnP' }];
  expect(canSubmitServiceFinanceReview('', sources, true, true)).toBe(false);
  expect(canSubmitServiceFinanceReview('99', sources, true, true)).toBe(false);
  expect(canSubmitServiceFinanceReview('11', sources, false, true)).toBe(false);
  expect(canSubmitServiceFinanceReview('11', sources, true, false)).toBe(false);
  expect(canSubmitServiceFinanceReview('11', sources, true, true)).toBe(true);
});
