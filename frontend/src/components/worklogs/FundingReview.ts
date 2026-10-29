import { ClaimCategory } from '../../types';

export type FundingSourceChoice = { id: number; code: string; name: string };
export const FIXED_DAILY_NO_BUDGET = 'FIXED_DAILY_NO_BUDGET';

const SERVICE_FUNDING_CODES = new Set(['PNP', 'SUPPLY_CHAIN', 'SUPPLYCHAIN', 'EPIC']);

export function supportedServiceFundingSources<T extends FundingSourceChoice>(sources: T[]): T[] {
  return sources.filter((source) => {
    const code = source.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const name = source.name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return SERVICE_FUNDING_CODES.has(code) || ['PNP', 'SUPPLYCHAIN', 'EPIC'].includes(name);
  });
}

export function buildServiceFinanceReviewPayload<T extends Record<string, unknown>>(
  payload: T,
  fundingSourceId: string,
): T & { funding_source_id: number } {
  return { ...payload, funding_source_id: Number(fundingSourceId) };
}

export function canSubmitServiceFinanceReview(fundingSourceId: string, sources: FundingSourceChoice[], reviewReached: boolean, reviewConfirmed: boolean): boolean {
  return Boolean(fundingSourceId)
    && sources.some((source) => String(source.id) === fundingSourceId)
    && reviewReached
    && reviewConfirmed;
}

const NON_SERVICE_FORM_TYPES = new Set(['SALARY', 'PAYROLL', 'STIPEND', 'STIPENDS', 'TIMESHEET']);

export function isActiveServiceCategory(category: ClaimCategory): boolean {
  return category.is_active
    && !NON_SERVICE_FORM_TYPES.has((category.form_type || '').trim().toUpperCase())
    && category.origin_channel?.toUpperCase() !== 'COMMUNITY';
}

export function serviceCategoriesForSource(categories: ClaimCategory[], fundingSourceId: string): ClaimCategory[] {
  if (!fundingSourceId) return [];
  return categories.filter((category) =>
    isActiveServiceCategory(category)
    && String(category.funding_source_id ?? '') === fundingSourceId,
  );
}

export function unconfiguredServiceCategories(categories: ClaimCategory[]): ClaimCategory[] {
  return categories.filter((category) =>
    isActiveServiceCategory(category) && category.funding_source_id == null,
  );
}

export function selectionAfterFundingSourceChange(fundingSourceId: string): { fundingSourceId: string; categoryId: string } {
  return { fundingSourceId, categoryId: '' };
}

export function reviewedFinanceContextChanged(
  selectedSourceId: string,
  selectedCategoryIdOrReviewedSourceId: string,
  reviewedSourceId?: string,
  reviewedCategoryId?: string,
): boolean {
  if (reviewedSourceId === undefined) return selectedSourceId !== selectedCategoryIdOrReviewedSourceId;
  return selectedSourceId !== reviewedSourceId || selectedCategoryIdOrReviewedSourceId !== reviewedCategoryId;
}

export function canRouteReviewedFinanceContext(contextIsDirty: boolean): boolean {
  return !contextIsDirty;
}
