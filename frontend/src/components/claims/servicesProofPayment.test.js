import {
  buildServicesProofBeneficiaries,
  canSelectServicesManifest,
  servicesProofAmount,
} from './servicesProofPayment';

const manifest = (overrides = {}) => ({
  claim_id: 41,
  provider_id: 9,
  provider_name: 'Amina N.',
  services: ['ANC visits', 'Immunization'],
  amount: '32000.00',
  currency: 'TZS',
  amount_recorded: '32000.00',
  outstanding_amount: '0.00',
  can_record_with_proof: true,
  ...overrides,
});

describe('Services proof payment payload', () => {
  it('uses full approved amount for proof-only claims with no outstanding balance', () => {
    expect(buildServicesProofBeneficiaries([manifest()])).toEqual([
      {
        claim_id: 41,
        provider_name: 'Amina N.',
        service_names: ['ANC visits', 'Immunization'],
        amount: '32000.00',
      },
    ]);
    expect(servicesProofAmount([manifest()])).toBe(32000);
  });

  it('does not allow mixing currencies or exceeding 25 selected claims', () => {
    const first = manifest();
    const second = manifest({ claim_id: 42, currency: 'KES' });
    expect(canSelectServicesManifest([first, second], [41], second)).toBe(false);
    expect(canSelectServicesManifest([first], Array.from({ length: 25 }, (_, index) => index + 1), manifest({ claim_id: 99 }))).toBe(false);
  });

  it('shows only the remaining payment on proof after a partial payment', () => {
    const partial = manifest({ amount_recorded: '12000.00', outstanding_amount: '20000.00' });
    expect(servicesProofAmount([partial, manifest({ claim_id: 42 })])).toBe(52000);
    expect(buildServicesProofBeneficiaries([partial])[0].amount).toBe('32000.00');
  });

  it('allows eligible claims in the same currency and rejects non-eligible rows', () => {
    const first = manifest();
    const second = manifest({ claim_id: 42 });
    expect(canSelectServicesManifest([first, second], [41], second)).toBe(true);
    expect(canSelectServicesManifest([first], [], manifest({ can_record_with_proof: false }))).toBe(false);
  });
});
