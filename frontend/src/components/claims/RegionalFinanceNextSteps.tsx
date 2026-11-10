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
          {sw ? 'Anza na kazi iliyoidhinishwa na RM katika mkoa wako.' : 'Start with RM-approved work in your assigned region.'}
        </p>
      </div>
      <div className="stack">
        <p><strong>{sw ? 'Mshahara' : 'Payroll'}:</strong> {sw ? 'angalia masaa na viashiria vya mwezi kwa kada na mtoa huduma.' : 'view monthly hours and indicators by cadre and provider.'}</p>
        <p><strong>{sw ? 'Huduma' : 'Services'}:</strong> {sw ? 'thibitisha chanzo cha fedha na kiasi, kisha chagua shirika la kulipa.' : 'confirm the funding source and amount, then select the paying organization.'}</p>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => navigate('finance-monthly')}>{sw ? 'Ripoti ya kazi ya mwezi' : 'Monthly work report'}</button>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('routing-queue')}>{sw ? 'Fungua Huduma za kukagua' : 'Review Services routing'}</button>
      </div>
    </section>
  );
}
