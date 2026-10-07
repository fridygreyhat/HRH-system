import React, { useEffect, useRef } from 'react';
import { useApi } from '../../hooks';
import { dateTime, humanize, money } from '../../format';
import { BudgetLine, BudgetTransaction } from '../../types';
import { AsyncState, Drawer, Facts, StatusBadge } from '../ui';

interface Ledger {
  line: BudgetLine;
  transactions: BudgetTransaction[];
}

const KIND_LABELS: Record<string, string> = {
  ALLOCATE: 'Allocation',
  COMMIT: 'Committed to claim',
  RELEASE: 'Commitment released',
  SPEND: 'Spent (payment recorded)',
  REALLOCATE_OUT: 'Reallocated out',
  REALLOCATE_IN: 'Reallocated in',
  IMPORT_ADJUST: 'Tracker import adjustment',
};

export function LedgerDrawer({
  lineId,
  refreshKey,
  onClose,
  actions,
}: {
  lineId: number;
  refreshKey: number;
  onClose: () => void;
  /** Buttons for the line (reallocate / reconcile), rendered by the page. */
  actions: (line: BudgetLine) => React.ReactNode;
}) {
  const { data, error, loading, reload } = useApi<Ledger>(`/budgets/lines/${lineId}/ledger`);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [refreshKey, reload]);
  return (
    <Drawer title={data ? `Budget line ${data.line.code}` : 'Budget line'} onClose={onClose} wide>
      <AsyncState data={data} error={error} loading={loading}>
        {({ line, transactions }) => (
          <div className="stack-lg">
            <Facts
              items={[
                ['Name', line.name],
                ['Organization', line.organization_name],
                ['Category', line.category_name],
                ['Period', line.period_label],
                ['Region', line.region_name],
                ['Source', humanize(line.source)],
                ['Allocated', money(line.allocated_amount, line.currency)],
                ['Committed', money(line.committed_amount, line.currency)],
                ['Spent', money(line.spent_amount, line.currency)],
                ['Available', <strong key="a">{money(line.available_amount, line.currency)}</strong>],
                ['Tracker sync', <StatusBadge key="s" status={line.sync_status} />],
                ['Tracker reference', line.external_ref],
                ['Last synced', line.last_synced_at ? dateTime(line.last_synced_at) : null],
              ]}
            />
            <div className="row">{actions(line)}</div>
            <section className="stack">
              <h3>Ledger</h3>
              <p className="muted small">Every allocation, commitment, release, payment and reallocation, oldest first. The ledger cannot be edited.</p>
              {transactions.length === 0 ? (
                <p className="muted">No transactions.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Kind</th>
                        <th className="num">Amount</th>
                        <th>Claim</th>
                        <th>Payment record</th>
                        <th>Reason</th>
                        <th>By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((t) => (
                        <tr key={t.id}>
                          <td className="nowrap">{dateTime(t.created_at)}</td>
                          <td>{KIND_LABELS[t.kind] || humanize(t.kind)}</td>
                          <td className="num">{money(t.amount, line.currency)}</td>
                          <td>{t.claim_id ? `#${t.claim_id}` : '—'}</td>
                          <td>{t.payment_record_id ? `#${t.payment_record_id}` : '—'}</td>
                          <td>{t.reason || '—'}</td>
                          <td>{t.actor_name || 'System'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </AsyncState>
    </Drawer>
  );
}
