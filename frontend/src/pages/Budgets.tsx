import React, { useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { qs } from '../api';
import { useApi } from '../hooks';
import { dateTime, humanize, money } from '../format';
import { BudgetLine, ClaimCategory, Named, Organization, PayPeriod } from '../types';
import { Alert, AsyncState, Field, StatusBadge, Tabs } from '../components/ui';
import { CreateLineModal, ReallocateModal, ReconcileModal } from '../components/budgets/BudgetDialogs';
import { LedgerDrawer } from '../components/budgets/LedgerDrawer';
import { SyncLogs, TrackerPanel } from '../components/budgets/TrackerSync';
import { canReallocateFrom, scopedOrgIds } from '../components/budgets/budgetAccess';

type View = 'lines' | 'sync';

interface Totals {
  currency: string;
  allocated: number;
  committed: number;
  spent: number;
  available: number;
}

function totalsByCurrency(lines: BudgetLine[]): Totals[] {
  const map = new Map<string, Totals>();
  lines.forEach((l) => {
    const t = map.get(l.currency) || { currency: l.currency, allocated: 0, committed: 0, spent: 0, available: 0 };
    t.allocated += l.allocated_amount;
    t.committed += l.committed_amount;
    t.spent += l.spent_amount;
    t.available += l.available_amount;
    map.set(l.currency, t);
  });
  return Array.from(map.values());
}

export function Budgets() {
  const { me, hasRole } = useAuth();
  const isFhiFinance = hasRole('FHI360_FINANCE');
  const isCsoFinance = hasRole('CSO_FINANCE');
  const canCreate = isFhiFinance || isCsoFinance;
  const canReallocate = canCreate || hasRole('RPM');
  const canSeeSyncLogs = isFhiFinance || hasRole('OVERSIGHT');
  const csoOnly = isCsoFinance && !hasRole('FHI360_FINANCE', 'RPM', 'OVERSIGHT');

  const [periodId, setPeriodId] = useState('');
  const [view, setView] = useState<View>('lines');
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [reallocFrom, setReallocFrom] = useState<number | 'any' | null>(null);
  const [reconciling, setReconciling] = useState<BudgetLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const lines = useApi<BudgetLine[]>(`/budgets/lines${qs({ period_id: periodId })}`);
  const allLines = useApi<BudgetLine[]>(periodId ? '/budgets/lines' : null);
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const organizations = useApi<Organization[]>(canCreate || canReallocate ? '/admin/organizations' : null);
  const categories = useApi<ClaimCategory[]>(canCreate ? '/admin/claim-categories' : null);
  const regions = useApi<Named[]>(canCreate ? '/admin/regions' : null);

  const fhiOrgIds = useMemo(() => new Set((organizations.data || []).filter((o) => o.type === 'FHI360').map((o) => o.id)), [organizations.data]);
  const creatableOrgs = useMemo(() => {
    const mine = scopedOrgIds(me);
    return (organizations.data || []).filter((o) => o.is_active && ((isFhiFinance && o.type === 'FHI360') || (isCsoFinance && o.type !== 'FHI360' && mine.has(o.id))));
  }, [organizations.data, me, isFhiFinance, isCsoFinance]);

  // Reallocation targets may lie outside the period filter, so use the unfiltered list when one is loaded.
  const everyLine = (periodId ? allLines.data : lines.data) || [];
  const sources = everyLine.filter((l) => canReallocateFrom(me, l, fhiOrgIds));

  const refresh = () => {
    lines.reload();
    if (periodId) allLines.reload();
    setRefreshKey((k) => k + 1);
  };

  const orgName = me?.organizations.map((o) => o.name).join(', ');
  const title = csoOnly && orgName ? `Budget – ${orgName}` : 'Budgets';

  const lineActions = (line: BudgetLine) => (
    <>
      {canReallocate && canReallocateFrom(me, line, fhiOrgIds) && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReallocFrom(line.id)}>
          Reallocate from this line
        </button>
      )}
      {isFhiFinance && line.source === 'FHI360_TRACKER' && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReconciling(line)}>
          Reconcile with tracker
        </button>
      )}
    </>
  );

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>{title}</h1>
        <div className="row">
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={!organizations.data}>
              New budget line
            </button>
          )}
          {canReallocate && (
            <button type="button" className="btn btn-secondary" onClick={() => setReallocFrom('any')} disabled={!sources.length}>
              Reallocate
            </button>
          )}
        </div>
      </div>

      <div className="notice" role="note">
        There is no live connection to the FHI360 HQ budget tracker. FHI360 lines are synchronised by file import/export.
      </div>

      <Alert kind="success">{notice}</Alert>

      <div className="row-between">
        <div className="filters">
          <Field label="Pay period">
            <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              <option value="">All periods</option>
              {(periods.data || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.period_label || `${p.start_date} – ${p.end_date}`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {canSeeSyncLogs && (
          <Tabs<View>
            label="Budget views"
            value={view}
            onChange={setView}
            tabs={[
              { key: 'lines', label: 'Budget lines' },
              { key: 'sync', label: 'Tracker sync' },
            ]}
          />
        )}
      </div>

      {view === 'lines' && (
        <AsyncState data={lines.data} error={lines.error} loading={lines.loading} empty="No budget lines for this selection.">
          {(rows) => (
            <div className="table-wrap">
              <table className="clickable">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Organization</th>
                    <th>Category</th>
                    <th>Period</th>
                    <th>Region</th>
                    <th className="num">Allocated</th>
                    <th className="num">Committed</th>
                    <th className="num">Spent</th>
                    <th className="num">Available</th>
                    <th>Tracker sync</th>
                    <th>Source</th>
                    <th>Tracker ref.</th>
                    <th>Last synced</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr
                      key={l.id}
                      tabIndex={0}
                      onClick={() => setOpenLine(l.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setOpenLine(l.id);
                      }}
                    >
                      <td className="nowrap">
                        <strong>{l.code}</strong>
                      </td>
                      <td>{l.name}</td>
                      <td>{l.organization_name}</td>
                      <td>{l.category_name}</td>
                      <td className="nowrap">{l.period_label}</td>
                      <td>{l.region_name}</td>
                      <td className="num">{money(l.allocated_amount, l.currency)}</td>
                      <td className="num">{money(l.committed_amount, l.currency)}</td>
                      <td className="num">{money(l.spent_amount, l.currency)}</td>
                      <td className="num">
                        <strong>{money(l.available_amount, l.currency)}</strong>
                      </td>
                      <td>
                        <StatusBadge status={l.sync_status} />
                      </td>
                      <td>{humanize(l.source)}</td>
                      <td>{l.external_ref || '—'}</td>
                      <td className="nowrap">{l.last_synced_at ? dateTime(l.last_synced_at) : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenLine(l.id);
                          }}
                        >
                          Ledger
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {totalsByCurrency(rows).map((t) => (
                    <tr key={t.currency}>
                      <th colSpan={6}>Total ({t.currency})</th>
                      <th className="num">{money(t.allocated, t.currency)}</th>
                      <th className="num">{money(t.committed, t.currency)}</th>
                      <th className="num">{money(t.spent, t.currency)}</th>
                      <th className="num">{money(t.available, t.currency)}</th>
                      <th colSpan={5} />
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          )}
        </AsyncState>
      )}

      {view === 'lines' && isFhiFinance && <TrackerPanel periodId={periodId} onChanged={refresh} />}

      {view === 'sync' && canSeeSyncLogs && <SyncLogs refreshKey={refreshKey} />}

      {openLine !== null && <LedgerDrawer lineId={openLine} refreshKey={refreshKey} onClose={() => setOpenLine(null)} actions={lineActions} />}

      {creating && (
        <CreateLineModal
          organizations={creatableOrgs}
          categories={(categories.data || []).filter((c) => c.is_active)}
          periods={periods.data || []}
          regions={regions.data || []}
          onClose={() => setCreating(false)}
          onCreated={(line) => {
            setCreating(false);
            setNotice(`Budget line ${line.code} created with ${money(line.allocated_amount, line.currency)}.`);
            refresh();
          }}
        />
      )}

      {reallocFrom !== null && (
        <ReallocateModal
          lines={everyLine}
          sources={sources}
          initialFrom={reallocFrom === 'any' ? undefined : reallocFrom}
          onClose={() => setReallocFrom(null)}
          onDone={() => {
            setReallocFrom(null);
            setNotice('Budget reallocated. Both lines and their ledgers have been updated.');
            refresh();
          }}
        />
      )}

      {reconciling && (
        <ReconcileModal
          line={reconciling}
          onClose={() => setReconciling(null)}
          onDone={(line) => {
            setReconciling(null);
            setNotice(`${line.code} marked as reconciled with the HQ tracker.`);
            refresh();
          }}
        />
      )}
    </div>
  );
}
