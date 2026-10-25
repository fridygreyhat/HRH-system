import React, { useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { qs } from '../api';
import { useApi } from '../hooks';
import { money } from '../format';
import { BudgetLine, ClaimCategory, Named, Organization, OrganizationsResponse, PayPeriod } from '../types';
import { Alert, AsyncState, Field, Tabs } from '../components/ui';
import { CreateLineModal, EditAllocationModal, ReallocateModal, ReconcileModal } from '../components/budgets/BudgetDialogs';
import { LedgerDrawer } from '../components/budgets/LedgerDrawer';
import { SyncLogs, TrackerPanel } from '../components/budgets/TrackerSync';
import { canManageBudgetLine, canReallocateFrom, creatableBudgetOrganizations } from '../components/budgets/budgetAccess';
import { BudgetHierarchy, grouped, remaining, totalsByCurrency } from '../components/budgets/BudgetHierarchy';

export { grouped, remaining, totalsByCurrency };

type View = 'lines' | 'sync';

export function Budgets({ initialCreate = false }: { initialCreate?: boolean }) {
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
  const [creating, setCreating] = useState(initialCreate);
  const [reallocFrom, setReallocFrom] = useState<number | 'any' | null>(null);
  const [reconciling, setReconciling] = useState<BudgetLine | null>(null);
  const [editing, setEditing] = useState<BudgetLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const lines = useApi<BudgetLine[]>(`/budgets/lines${qs({ period_id: periodId })}`);
  const allLines = useApi<BudgetLine[]>(periodId ? '/budgets/lines' : null);
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const organizations = useApi<Organization[]>(canCreate || canReallocate ? '/admin/organizations' : null);
  const organizationScope = useApi<OrganizationsResponse>('/organizations');
  const categories = useApi<ClaimCategory[]>(canCreate ? '/admin/claim-categories' : null);
  const regions = useApi<Named[]>(canCreate ? '/admin/regions' : null);

  const fhiOrgIds = useMemo(() => new Set([...(organizations.data || []), ...(organizationScope.data?.organizations || [])].filter((o) => o.type === 'FHI360').map((o) => o.id)), [organizations.data, organizationScope.data]);
  const creatableOrgs = useMemo(
    () => creatableBudgetOrganizations(me, organizations.data || []),
    [organizations.data, me],
  );

  // Reallocation targets may lie outside the period filter, so use the unfiltered list when one is loaded.
  const everyLine = (periodId ? allLines.data : lines.data) || [];
  const sources = everyLine.filter((l) => canReallocateFrom(me, l, fhiOrgIds) && (fhiOrgIds.has(l.organization_id) || l.region_id != null));
  const refresh = () => {
    lines.reload();
    if (periodId) allLines.reload();
    setRefreshKey((k) => k + 1);
  };

  const orgName = me?.organizations.map((o) => o.name).join(', ');
  const title = csoOnly && orgName ? `Budget – ${orgName}` : 'Budgets';

  const lineActions = (line: BudgetLine) => (
    <>
      {canManageBudgetLine(me, line, organizations.data || [], organizationScope.data?.assignments || []) && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={(event) => { event.stopPropagation(); setEditing(line); }}>
          Edit estimate / cap
        </button>
      )}
      {canReallocate && canReallocateFrom(me, line, fhiOrgIds) && (fhiOrgIds.has(line.organization_id) || line.region_id != null) && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={(event) => { event.stopPropagation(); setReallocFrom(line.id); }}>
          Reallocate from this line
        </button>
      )}
      {isFhiFinance && line.source === 'FHI360_TRACKER' && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={(event) => { event.stopPropagation(); setReconciling(line); }}>
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
        Estimates are soft planning thresholds; reaching one warns but does not stop approval. The hard cap is the strict limit. Exposure is committed plus spent, currency totals stay separate, and historic lines with no estimate remain “Not set.” There is no live connection to the FHI360 HQ budget tracker; FHI360 lines are synchronised by file import/export.
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
          {(rows) => <BudgetHierarchy lines={rows} fhiOrganizationIds={fhiOrgIds} onOpenLine={(line) => setOpenLine(line.id)} renderActions={lineActions} />}
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
      {editing && (
        <EditAllocationModal
          line={editing}
          onClose={() => setEditing(null)}
          onDone={(line) => {
            setEditing(null);
            setNotice(`${line.code} allocation updated. ${line.budget_status === 'ESTIMATE_REACHED' ? 'Estimate warning is active.' : ''}`);
            refresh();
          }}
        />
      )}

      {reallocFrom !== null && (
        <ReallocateModal
          lines={everyLine}
          sources={sources}
          fhiOrgIds={fhiOrgIds}
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
