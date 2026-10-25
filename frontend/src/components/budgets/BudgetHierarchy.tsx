import React from 'react';
import { humanize, money } from '../../format';
import { BudgetLine } from '../../types';
import { StatusBadge } from '../ui';
import './budget-hierarchy.css';

export interface BudgetCurrencyTotals {
  currency: string;
  allocated: number;
  committed: number;
  spent: number;
  available: number;
  estimated: number;
  estimatesSet: number;
  estimatesNotSet: number;
}

export function remaining(line: BudgetLine): number {
  return line.allocated_amount - line.committed_amount - line.spent_amount;
}

export function totalsByCurrency(lines: BudgetLine[]): BudgetCurrencyTotals[] {
  const map = new Map<string, BudgetCurrencyTotals>();
  lines.forEach((line) => {
    const total = map.get(line.currency) || { currency: line.currency, allocated: 0, committed: 0, spent: 0, available: 0, estimated: 0, estimatesSet: 0, estimatesNotSet: 0 };
    total.allocated += line.allocated_amount;
    total.committed += line.committed_amount;
    total.spent += line.spent_amount;
    total.available += remaining(line);
    if (line.estimated_amount == null) total.estimatesNotSet += 1;
    else {
      total.estimated += line.estimated_amount;
      total.estimatesSet += 1;
    }
    map.set(line.currency, total);
  });
  return Array.from(map.values());
}

export function budgetStatus(line: BudgetLine): string {
  if (line.budget_status) return line.budget_status;
  const exposure = Number(line.committed_amount || 0) + Number(line.spent_amount || 0);
  if (exposure >= Number(line.allocated_amount) && exposure > 0) return 'HARD_CAP_REACHED';
  if (line.estimated_amount != null && exposure >= line.estimated_amount && exposure > 0) return 'ESTIMATE_REACHED';
  return line.estimated_amount == null ? 'NOT_SET' : 'WITHIN_ESTIMATE';
}

export function grouped(lines: BudgetLine[], keyOf: (line: BudgetLine) => string, labelOf: (line: BudgetLine) => string) {
  const groups = new Map<string, { label: string; lines: BudgetLine[] }>();
  lines.forEach((line) => {
    const key = keyOf(line);
    const group = groups.get(key) || { label: labelOf(line), lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

function SummaryTotals({ lines }: { lines: BudgetLine[] }) {
  const totals = totalsByCurrency(lines);
  return (
    <div className="budget-summary-totals" aria-label="Totals by currency">
      {totals.map((total) => (
        <div className="budget-summary-currency" key={total.currency}>
          <strong>{total.currency}</strong>
          <span><small>Hard cap</small>{money(total.allocated, total.currency)}</span>
          <span><small>Committed</small>{money(total.committed, total.currency)}</span>
          <span><small>Spent</small>{money(total.spent, total.currency)}</span>
          <span><small>Remaining</small>{money(total.available, total.currency)}</span>
          <span><small>Estimates set · {total.estimatesSet}</small>{total.estimatesSet ? money(total.estimated, total.currency) : 'Not set'}</span>
          {total.estimatesNotSet > 0 && <span><small>Not set · {total.estimatesNotSet} lines</small>—</span>}
        </div>
      ))}
    </div>
  );
}

export function BudgetHierarchy({
  lines,
  fhiOrganizationIds,
  onOpenLine,
  renderActions,
  emptyMessage = 'No budget lines in this view.',
}: {
  lines: BudgetLine[];
  fhiOrganizationIds?: ReadonlySet<number>;
  onOpenLine?: (line: BudgetLine) => void;
  renderActions?: (line: BudgetLine) => React.ReactNode;
  emptyMessage?: string;
}) {
  const isFhiLine = (line: BudgetLine) => line.source === 'FHI360_TRACKER' || !!fhiOrganizationIds?.has(line.organization_id);
  const regionLabel = (line: BudgetLine) => line.region_id == null
    ? isFhiLine(line) ? 'All regions' : 'Legacy · all regions'
    : line.region_name;
  const hasActions = !!onOpenLine || !!renderActions;

  if (!lines.length) return <div className="budget-hierarchy-empty">{emptyMessage}</div>;

  return (
    <div className="budget-hierarchy">
      {grouped(lines, (line) => String(line.organization_id), (line) => line.organization_name).map((organization) => (
        <details className="budget-level budget-org" key={organization.lines[0]?.organization_id} open>
          <summary>
            <span>Organization</span><strong>{organization.label}</strong>
            <small>{organization.lines.length} line{organization.lines.length === 1 ? '' : 's'}</small>
            <SummaryTotals lines={organization.lines} />
          </summary>
          {grouped(organization.lines, (line) => line.region_id == null ? 'all-regions' : String(line.region_id), (line) => regionLabel(line)).map((region) => (
            <details className="budget-level budget-region" key={`${organization.lines[0]?.organization_id}-${region.lines[0]?.region_id ?? 'legacy'}`} open>
              <summary>
                <span>Region</span><strong>{region.label}</strong>
                <SummaryTotals lines={region.lines} />
              </summary>
              {grouped(region.lines, (line) => String(line.category_id), (line) => line.category_name).map((category) => (
                <details className="budget-level budget-category" key={`${region.label}-${category.lines[0]?.category_id}`} open>
                  <summary>
                    <span>Activity or payment type</span><strong>{category.label}</strong>
                    <SummaryTotals lines={category.lines} />
                  </summary>
                  {grouped(category.lines, (line) => String(line.period_id), (line) => line.period_label).map((period) => (
                    <section className="budget-period" key={period.lines[0]?.period_id}>
                      <div className="budget-period-title">
                        <span>Pay period</span><strong>{period.label}</strong><SummaryTotals lines={period.lines} />
                      </div>
                      <div className="table-wrap">
                        <table className={`${hasActions ? 'clickable ' : ''}budget-line-table`}>
                          <thead><tr>
                            <th>Allocation</th><th>Organization</th><th>Region</th><th>Activity or payment type</th><th>Period</th>
                            <th className="num">Estimate</th><th className="num">Exposure</th><th>Status</th>
                            <th className="num">Hard cap</th><th className="num">Committed</th><th className="num">Spent</th><th className="num">Remaining</th>
                            <th>Tracker</th><th>Source</th>{hasActions && <th>Actions</th>}
                          </tr></thead>
                          <tbody>
                            {period.lines.map((line) => (
                              <tr
                                key={line.id}
                                tabIndex={onOpenLine ? 0 : undefined}
                                onClick={onOpenLine ? () => onOpenLine(line) : undefined}
                                onKeyDown={onOpenLine ? (event) => { if (event.key === 'Enter') onOpenLine(line); } : undefined}
                              >
                                <td className="nowrap"><strong>{line.code}</strong><div className="muted small">{line.name}</div></td>
                                <td>{line.organization_name}</td>
                                <td>{line.region_id == null && !isFhiLine(line) ? <span className="badge badge-warn">{regionLabel(line)}</span> : regionLabel(line)}</td>
                                <td>{line.category_name}</td><td className="nowrap">{line.period_label}</td>
                                <td className="num">{line.estimated_amount == null ? <span className="muted">Not set</span> : money(line.estimated_amount, line.currency)}</td>
                                <td className="num">{money(line.exposure_amount ?? (line.committed_amount + line.spent_amount), line.currency)}</td>
                                <td><span className={`badge ${budgetStatus(line) === 'HARD_CAP_REACHED' ? 'badge-danger' : budgetStatus(line) === 'ESTIMATE_REACHED' ? 'badge-warn' : 'badge-info'}`}>{budgetStatus(line).replaceAll('_', ' ')}</span></td>
                                <td className="num">{money(line.allocated_amount, line.currency)}</td>
                                <td className="num">{money(line.committed_amount, line.currency)}</td>
                                <td className="num">{money(line.spent_amount, line.currency)}</td>
                                <td className="num"><strong>{money(remaining(line), line.currency)}</strong></td>
                                <td><StatusBadge status={line.sync_status} /></td><td>{humanize(line.source)}</td>
                                {hasActions && <td>
                                  {onOpenLine && <button type="button" className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); onOpenLine(line); }}>Ledger</button>}
                                  {renderActions?.(line)}
                                </td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </details>
              ))}
            </details>
          ))}
        </details>
      ))}
      <section className="budget-overall-totals">
        <strong>Visible budget total</strong><SummaryTotals lines={lines} />
      </section>
    </div>
  );
}
