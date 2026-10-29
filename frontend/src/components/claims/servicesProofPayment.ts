import { PaymentManifest } from '../../types';

export interface ServicesProofBeneficiary {
  claim_id: number;
  provider_name: string;
  service_names: string[];
  amount: string;
}

/** The API receives the full approved claim amount, including for proof-only confirmation. */
export function buildServicesProofBeneficiaries(rows: PaymentManifest[]): ServicesProofBeneficiary[] {
  return rows.map((row) => ({
    claim_id: row.claim_id,
    provider_name: row.provider_name,
    service_names: row.services,
    amount: row.amount,
  }));
}

export function canSelectServicesManifest(
  rows: PaymentManifest[],
  selectedIds: number[],
  candidate: PaymentManifest,
): boolean {
  if (!candidate.can_record_with_proof || selectedIds.includes(candidate.claim_id) || selectedIds.length >= 25) return false;
  const selected = rows.find((row) => selectedIds.includes(row.claim_id));
  return !selected || selected.currency === candidate.currency;
}

export function servicesProofAmount(rows: PaymentManifest[]): number {
  return rows.reduce((sum, row) => sum + (
    Number(row.outstanding_amount) > 0 ? Number(row.outstanding_amount) : Number(row.amount)
  ), 0);
}
