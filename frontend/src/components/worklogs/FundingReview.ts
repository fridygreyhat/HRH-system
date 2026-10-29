import { ClaimCategory } from '../../types';

export type FundingSourceChoice = { id: number; code: string; name: string };

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
  selectedCategoryId: string,
  reviewedSourceId: string,
  reviewedCategoryId: string,
): boolean {
  return selectedSourceId !== reviewedSourceId || selectedCategoryId !== reviewedCategoryId;
}

export function canRouteReviewedFinanceContext(contextIsDirty: boolean): boolean {
  return !contextIsDirty;
}
