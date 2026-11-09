import React from 'react';
import { useAuth } from '../../AuthContext';
import { navigate } from '../../nav';

/** Regional Finance works from RM-approved records, not the legacy manual claim form. */
export function RegionalFinanceNextSteps() {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  return (
    <section className="card stack" aria-label={sw ? 'Mtiririko wa Fedha ya Mkoa' : 'Regional Finance workflow'}>
      <div>
        <h2>{sw ? 'Eneo la kazi la Fedha ya Mkoa' : 'Regional Finance workspace'}</h2>
        <p className="muted small">
          {sw ? 'Anza na kazi iliyoidhinishwa na RM katika mkoa uliopangiwa. Usiandae dai jipya kwa mkono.' : 'Start with RM-approved work in your assigned region. Do not prepare a new manual claim.'}
        </p>
      </div>
      <div className="stack">
        <p><strong>Payroll:</strong> {sw ? 'angalia masaa ya kila mwezi na jumla za viashiria kwa kada na mtoa huduma. Kategoria ya dai, chanzo cha fedha, bajeti au idhini ya Fedha havihitajiki.' : 'view monthly hours and indicator totals by cadre and provider. No claim category, funding source, budget or finance approval is required.'}</p>
        <p><strong>{sw ? 'Huduma' : 'Services'}:</strong> {sw ? 'tumia foleni ya Huduma za kukagua kuthibitisha chanzo cha fedha cha PnP, Supply Chain au EpiC na kiasi maalum cha kila siku, kisha chagua shirika linalostahili kulipa. Kiasi kikubwa zaidi cha huduma kinachostahili kwa siku ndicho kinachotumika.' : 'use the routing queue to confirm the PnP, Supply Chain or EpiC funding source and fixed daily amount, then select the eligible paying organization. The highest eligible service amount per day is used.'}</p>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => navigate('finance-monthly')}>{sw ? 'Ripoti ya kazi ya mwezi' : 'Monthly work report'}</button>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('routing-queue')}>{sw ? 'Fungua Huduma za kukagua' : 'Review Services routing'}</button>
      </div>
    </section>
  );
}
