import React from 'react';
import { navigate } from '../../nav';

/** Regional Finance works from RM-approved records, not the legacy manual claim form. */
export function RegionalFinanceNextSteps() {
  return (
    <section className="card stack" aria-label="Regional Finance workflow">
      <div>
        <h2>Regional Finance workspace</h2>
        <p className="muted small">
          Start with RM-approved work in your assigned region. Do not prepare a new manual claim.
        </p>
      </div>
      <div className="stack">
        <p><strong>Payroll:</strong> view monthly hours and indicator totals by cadre and provider. No claim category, funding source, budget or finance approval is required.</p>
        <p><strong>Services:</strong> use the routing queue to review authorized work and its payment setup, then select the eligible paying organization. Services payment and budget safeguards remain in place.</p>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => navigate('finance-monthly')}>Monthly work report</button>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('routing-queue')}>Review Services routing</button>
      </div>
    </section>
  );
}
