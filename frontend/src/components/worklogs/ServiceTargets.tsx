import React from 'react';
import { dateOnly, num } from '../../format';
import { ServiceTarget } from '../../types';

/** Days recorded against each service's monthly minimum. Information only: it never stops submission or changes pay. */
export function ServiceTargets({ rows, lang, endDate }: { rows?: ServiceTarget[]; lang: 'en' | 'sw'; endDate?: string }) {
  if (!rows?.length) return null;
  const sw = lang === 'sw';
  const met = rows.filter(row => !row.left).length;
  return (
    <section className="card stack" aria-labelledby="service-targets-title">
      <div className="row-between">
        <h3 id="service-targets-title">{sw ? 'Siku za huduma mwezi huu' : 'Service days this month'}</h3>
        <span className="muted small">{sw ? `Huduma ${num(met)} kati ya ${num(rows.length)} zimefikia kiwango` : `${num(met)} of ${num(rows.length)} minimums met`}</span>
      </div>
      <ul className="target-list">
        {rows.map((row) => (
          <li key={row.service} className={`target-row${row.left ? '' : ' is-met'}`}>
            <div className="target-head">
              <span className="target-name">{sw ? row.service_sw : row.service}</span>
              <span className="small">
                {sw ? `Siku ${num(row.days)} kati ya ${num(row.min_days)}` : `${num(row.days)} of ${num(row.min_days)} days`}
                {' · '}
                {row.left
                  ? <span className="badge badge-warn">{sw ? `Bado siku ${num(row.left)}` : `${num(row.left)} more ${row.left === 1 ? 'day' : 'days'}`}</span>
                  : <span className="badge badge-success">{sw ? 'Imekamilika' : 'Minimum met'}</span>}
              </span>
            </div>
            <div className="target-bar" role="progressbar" aria-label={row.service} aria-valuemin={0} aria-valuemax={row.min_days} aria-valuenow={Math.min(row.days, row.min_days)}>
              <div className="target-fill" style={{ width: `${Math.min(100, (row.days / row.min_days) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {endDate && <p className="muted small">{sw ? `Mwezi wa kazi unaisha ${dateOnly(endDate)}.` : `Work month ends ${dateOnly(endDate)}.`}</p>}
    </section>
  );
}
