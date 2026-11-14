import React from 'react';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Empty } from '../components/ui';
import { dateTime, num } from '../format';
import { useApi } from '../hooks';
import { navigate } from '../nav';
import { SignoffItem, signoffTarget } from '../signoffs';
import './finance-monthly-report.css';

const monthText = (month: string, sw: boolean) =>
  new Intl.DateTimeFormat(sw ? 'sw-TZ' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));

/**
 * Regional Finance sends Payroll to the CSO by signing each region's monthly Payroll report. Payroll timesheets are
 * not routed one by one: RM's approval ends their steps, and the signed report is what the CSO receives and pays from.
 */
export function PayrollToCso() {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const status = useApi<SignoffItem[]>('/finance/monthly-report/status');
  return (
    <div className="stack-lg">
      <header className="page-header">
        <h1>{sw ? 'Mshahara kwa CSO' : 'Payroll to CSO'}</h1>
        <p className="muted">{sw
          ? 'Majedwali ya Mshahara yaliyoidhinishwa na RM hutumwa kwa CSO kwa kusaini ripoti ya Mshahara ya kila mkoa kwa mwezi. Mara tu unaposaini, CSO inapata majedwali ya mshahara na fomu ya malipo.'
          : 'RM-approved Payroll timesheets go to the CSO when you sign each region’s monthly Payroll report. As soon as you sign, the CSO gets the salary timesheets and the payment form.'}</p>
      </header>
      <AsyncState data={status.data} error={status.error} loading={status.loading}>
        {(data) => {
          const payroll = data.filter((item) => item.work_type === 'PAYROLL');
          const waiting = payroll.filter((item) => item.state !== 'SIGNED');
          if (!payroll.length) {
            return <Empty>{sw ? 'Hakuna Mshahara ulioidhinishwa na RM katika miezi mitatu iliyopita.' : 'No RM-approved Payroll in the last three pay months.'}</Empty>;
          }
          return (
            <div className="stack">
              {waiting.length > 0
                ? <Alert kind="warn">{sw ? `Ripoti ${num(waiting.length)} za Mshahara hazijatumwa kwa CSO.` : `${num(waiting.length)} Payroll ${waiting.length === 1 ? 'report has' : 'reports have'} not been sent to the CSO.`}</Alert>
                : <Alert kind="success">{sw ? 'Mshahara wote umetumwa kwa CSO.' : 'All Payroll has been sent to the CSO.'}</Alert>}
              <ul className="payroll-to-cso">
                {payroll.map((item) => (
                  <li key={signoffTarget(item)} className={`is-${item.state.toLowerCase()}`}>
                    <div className="payroll-row">
                      <span className="payroll-text">
                        <strong>{monthText(item.month, sw)} · {item.region_name}</strong>
                        <span className="muted small">
                          {sw ? `Watoa huduma ${num(item.providers)} walioidhinishwa na RM` : `${num(item.providers)} RM-approved ${item.providers === 1 ? 'provider' : 'providers'}`}
                          {item.state === 'SIGNED' && item.approved_at
                            ? ` · ${sw ? 'imetumwa' : 'sent'} ${dateTime(item.approved_at)} ${sw ? 'na' : 'by'} ${item.approved_by_name}` : ''}
                        </span>
                      </span>
                      <span className={`badge ${item.state === 'SIGNED' ? 'badge-success' : 'badge-warn'}`}>
                        {item.state === 'SIGNED' ? (sw ? 'Imetumwa kwa CSO' : 'Sent to CSO')
                          : item.state === 'CHANGED' ? (sw ? 'Imebadilika: tuma tena' : 'Changed: send again') : (sw ? 'Haijatumwa' : 'Not sent')}
                      </span>
                      {item.to_approve ? (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('bulk-approval', `PAYROLL:${item.month}:${item.region_id}`)}>
                          {sw ? `Idhinisha ${num(item.to_approve)} kwanza` : `Approve ${num(item.to_approve)} timesheets first`}
                        </button>
                      ) : (
                        <button type="button" className={`btn btn-sm ${item.state === 'SIGNED' ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => navigate('finance-monthly', signoffTarget(item))}>
                          {item.state === 'SIGNED' ? (sw ? 'Fungua ripoti' : 'Open report') : (sw ? 'Pitia na utume kwa CSO' : 'Review and send to CSO')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        }}
      </AsyncState>
    </div>
  );
}
