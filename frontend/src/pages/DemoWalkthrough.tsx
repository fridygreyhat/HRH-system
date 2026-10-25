import React, { useMemo, useState } from 'react';
import { api, saveBlob } from '../api';
import { Alert, Section } from '../components/ui';
import { dateTime, humanize, money, roleLabel } from '../format';
import { useApi } from '../hooks';
import { DemoScenario, DemoStep, DemoWorkflowResponse } from '../types-demo';

type FilterKey = 'region' | 'cadre' | 'work_type' | 'route' | 'variant';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'region', label: 'Region' },
  { key: 'cadre', label: 'Cadre' },
  { key: 'work_type', label: 'Work type' },
  { key: 'route', label: 'Route' },
  { key: 'variant', label: 'Scenario variant' },
];

const ROLE_GUIDANCE: Record<string, string> = {
  PROVIDER: 'Provider: records work for the period and submits it. CTC verification follows, then the work moves into technical review.',
  SUPERVISOR: 'CTC / Supervisor: checks submitted work against facility context, then verifies or returns it for correction.',
  FACILITY_IN_CHARGE: 'Facility In-Charge: supplies the facility endorsement when the cadre or workflow requires it. This walkthrough shows only the recorded approval step.',
  TECHNICAL_OFFICER: 'Technical Officer: reviews the work and applies the technical endorsement for the assigned cadre. The page is a read-only record, not an approval screen.',
  RPM: 'Regional Program Manager: operational approval across all regional cadres. RPM approval is not a payment action and there is no payment button here.',
  REGIONAL_FINANCE: 'Regional Finance: reviews the pending claim and confirms the explicit payor context before routing. This is review only, not a payment action.',
  FHI360_FINANCE: 'FHI360 Finance: handles the recorded FHI360-payor path and batch preparation. External execution is not initiated here.',
  CSO_FINANCE: 'CSO Finance: receives the recorded CSO handoff, records external payment evidence and reconciles with a second person in the operational process.',
  COMMUNITY_VERIFIER: 'Community Verifier: validates recorded community-service evidence before downstream claim review.',
};

function finalStatus(scenario: DemoScenario): string {
  const last = scenario.steps[scenario.steps.length - 1];
  return last?.claim?.payment_status || last?.claim?.status || last?.work_log?.status || last?.batch?.status || '—';
}

function RouteNote({ route, workType }: { route: string; workType: string }) {
  const isPayroll = workType.toUpperCase() === 'PAYROLL';
  const routeName = route.toUpperCase();
  if (isPayroll && routeName === 'C') {
    return <p className="small muted">New payroll direct-to-CSO path: the payroll batch goes directly to its named CSO payor; it does not use the legacy Route B FHI360 handoff.</p>;
  }
  if (routeName === 'B') {
    return <p className="small muted">Legacy Route B: FHI360 prepares and hands the batch to the CSO executor. The handoff is distinct from new payroll direct-to-CSO.</p>;
  }
  if (routeName === 'C') {
    return <p className="small muted">Route C is the CSO community-payment route; it is distinct from legacy Route B facility payroll handoff.</p>;
  }
  return <p className="small muted">Route A: FHI360 is the recorded payor. Payment execution happens outside this system; its reference and proof are recorded here.</p>;
}

function StepDetail({ step, proofBusy, proofError, onDownloadProof }: { step: DemoStep; proofBusy: boolean; proofError: string | null; onDownloadProof: () => void }) {
  return (
    <div className="stack">
      <div className="demo-role-preview">
        <div>
          <div className="demo-label">Recorded role · not impersonation</div>
          <h3>{roleLabel(step.role)}</h3>
          <div className="muted small">{step.actor}</div>
        </div>
        <div>
          <div className="demo-label">Role guidance</div>
          <p className="small">{ROLE_GUIDANCE[step.role] || `Recorded step for ${roleLabel(step.role)}. This selection only navigates the immutable replay; it never grants a role.`}</p>
        </div>
      </div>
      <div>
        <div className="demo-label">Recorded action</div>
        <h2 className="demo-step-title">{step.title}</h2>
        <p>{step.explanation}</p>
        <p className="small muted"><strong>Expected:</strong> {step.expected}</p>
      </div>
      {step.work_log && (
        <Section title="Work log snapshot">
          <div className="row-between">
            <div className="row-inline"><span>Work log #{step.work_log.id}</span><span className="badge badge-info">{step.work_log.status}</span></div>
            <span className="muted small">{step.work_log.work_type} · {step.work_log.period_label}</span>
          </div>
          <div className="stats">
            <div className="demo-stat"><strong>{step.work_log.entry_count}</strong><span>Entries</span></div>
            <div className="demo-stat"><strong>{step.work_log.total_hours}</strong><span>Total hours</span></div>
            <div className="demo-stat"><strong>{step.work_log.financial_total === null ? '—' : money(step.work_log.financial_total, step.work_log.currency || 'TZS')}</strong><span>Financial total</span></div>
          </div>
          <div>
            <h4 className="demo-section-title">Recorded work entries</h4>
            {step.work_log.entries.length ? <div className="demo-entry-list">{step.work_log.entries.map((entry, i) => (
              <div className="demo-entry" key={`${entry.date}-${i}`}>
                <span className="demo-entry-date">{entry.date}</span><span>{entry.activity}</span><strong>{entry.hours} h</strong>
                {Object.keys(entry.measures).length > 0 && <div className="demo-measures">{Object.entries(entry.measures).map(([key, value]) => <span key={key}>{humanize(key)}: {value}</span>)}</div>}
              </div>
            ))}</div> : <p className="muted small">No entries captured in this snapshot.</p>}
          </div>
          <div>
            <h4 className="demo-section-title">Available actions captured at this step</h4>
            {step.work_log.available_actions.length ? <div className="demo-action-list">{step.work_log.available_actions.map((action) => <button type="button" className="btn btn-secondary btn-sm" disabled key={action}>{humanize(action)}</button>)}</div> : <p className="muted small">No actions captured.</p>}
            <p className="muted small">Demonstration only — disabled, with no live calls.</p>
          </div>
        </Section>
      )}
      {step.claim && (
        <Section title="Claim and payment record">
          <div className="demo-split">
            <div className="stack">
              <div className="row-inline"><span className="badge badge-info">Claim: {step.claim.status}</span><span className="badge badge-neutral">Payment: {step.claim.payment_status}</span></div>
              <dl className="facts">
                <div><dt>Claim amount</dt><dd>{money(step.claim.amount, step.claim.currency)}</dd></div>
                <div><dt>Amount paid</dt><dd>{money(step.claim.amount_paid, step.claim.currency)}</dd></div>
                <div><dt>Proof count</dt><dd>{step.claim.proof_count}</dd></div>
                <div><dt>Category</dt><dd>{step.claim.category_name || '—'}</dd></div>
                <div><dt>Payor</dt><dd>{step.claim.payor_name || '—'}</dd></div>
                <div><dt>Executor</dt><dd>{step.claim.executor_name || '—'}</dd></div>
                <div><dt>Budget / claim status</dt><dd>{step.claim.status}</dd></div>
                <div><dt>Budget line</dt><dd>{step.claim.budget_line || '—'}</dd></div>
              </dl>
            </div>
            <div className="stack">
              <h4 className="demo-section-title">Captured pricing</h4>
              {step.claim.components.length ? <div className="table-wrap"><table><thead><tr><th>Component</th><th>Units</th><th>Rate</th><th className="num">Amount</th></tr></thead><tbody>{step.claim.components.map((item, i) => <tr key={`${item.name}-${i}`}><td>{item.name}</td><td>{item.units}</td><td>{money(item.rate, step.claim!.currency)}</td><td className="num">{money(item.amount, step.claim!.currency)}</td></tr>)}</tbody></table></div> : <p className="muted small">No pricing components captured.</p>}
            </div>
          </div>
          <div className="demo-split">
            <div>
              <h4 className="demo-section-title">Workflow actions · disabled demonstration</h4>
              <div className="demo-action-list">{[...step.claim.available_actions, ...step.claim.payment_actions].length ? [...step.claim.available_actions, ...step.claim.payment_actions].map((action, i) => <button type="button" className="btn btn-secondary btn-sm" disabled key={`${action}-${i}`}>{humanize(action)}</button>) : <span className="muted small">No actions captured.</span>}</div>
            </div>
            <div>
              <h4 className="demo-section-title">Claim audit</h4>
              {step.claim.audit.length ? <div className="demo-audit">{step.claim.audit.map((audit, i) => <div className="demo-audit-row" key={`${audit.action}-${i}`}><span><strong>{humanize(audit.action)}</strong><br /><span className="muted">{roleLabel(audit.role)}</span></span><span className="badge badge-neutral">{audit.status}</span></div>)}</div> : <p className="muted small">No audit events captured.</p>}
            </div>
          </div>
          {step.claim.proof_count > 0 && (
            <div className="callout">
              <div className="row-between">
                <div><strong>Sample proof available</strong><p className="small">A simulated PDF for inspection. It is not evidence of a real payment.</p></div>
                <button type="button" className="btn btn-secondary" onClick={onDownloadProof} disabled={proofBusy}>{proofBusy ? 'Preparing PDF…' : 'Download sample proof PDF'}</button>
              </div>
              {proofError && <div style={{ marginTop: '.65rem' }}><Alert>{proofError}</Alert></div>}
            </div>
          )}
        </Section>
      )}
      {step.batch && (
        <Section title="Recorded batch">
          <dl className="facts">
            <div><dt>Reference</dt><dd>{step.batch.reference}</dd></div>
            <div><dt>Batch status</dt><dd><span className="badge badge-info">{step.batch.status}</span></dd></div>
            <div><dt>Lines</dt><dd>{step.batch.line_count}</dd></div>
            <div><dt>Total</dt><dd>{money(step.batch.total_amount, step.batch.currency)}</dd></div>
            <div><dt>Payor</dt><dd>{step.batch.payor_name || '—'}</dd></div>
            <div><dt>Executor</dt><dd>{step.batch.executor_name || '—'}</dd></div>
          </dl>
          <p className="small muted"><strong>CSV / XLSX:</strong> available for this recorded batch flow. This replay does not download or create a file.</p>
        </Section>
      )}
    </div>
  );
}

export function DemoWalkthrough() {
  const { data, error, loading, reload } = useApi<DemoWorkflowResponse>('/demos/workflows');
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ region: '', cadre: '', work_type: '', route: '', variant: '' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  const downloadSampleProof = async () => {
    setProofBusy(true);
    setProofError(null);
    try {
      const file = await api.blob('/demos/sample-proof.pdf', 'GET', 'sample-proof-demo.pdf');
      saveBlob(file);
    } catch (e) {
      setProofError((e as Error).message || 'Could not download the sample proof. Try again.');
    } finally {
      setProofBusy(false);
    }
  };

  const options = useMemo(() => {
    const scenarios = data?.scenarios || [];
    return Object.fromEntries(FILTERS.map(({ key }) => [key, Array.from(new Set(scenarios.map((scenario) => scenario[key]).filter(Boolean))).sort()])) as Record<FilterKey, string[]>;
  }, [data]);
  const filtered = useMemo(() => (data?.scenarios || []).filter((scenario) => FILTERS.every(({ key }) => !filters[key] || scenario[key] === filters[key])), [data, filters]);
  const selected = filtered.find((scenario) => scenario.id === selectedId) || filtered[0] || null;
  const step = selected?.steps[stepIndex] || null;

  const changeFilter = (key: FilterKey, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setSelectedId(null);
    setStepIndex(0);
  };
  const chooseScenario = (scenario: DemoScenario) => {
    setSelectedId(scenario.id);
    setStepIndex(0);
  };
  const reset = () => setStepIndex(0);

  return (
    <div className="demo-page">
      <div className="demo-banner" role="note">
        <span className="demo-banner-mark">SIMULATED DEMO</span>
        <div><strong>No real SMS or payments.</strong><p>Immutable snapshots from isolated backend API runs. Role choices navigate recorded steps only; nothing here changes accounts, work logs, claims, or money.</p></div>
      </div>
      <header className="demo-intro">
        <div className="demo-intro-copy"><div className="demo-kicker">Recorded workflow library</div><h1>Approval, step by step.</h1><p className="muted">Explore actual recorded approval paths across provider, work type and payment route. This is a replay viewer — not live role impersonation.</p></div>
        {data && <div className="demo-stats" aria-label="Snapshot totals"><div className="demo-stat"><strong>{data.summary.scenario_count}</strong><span>Scenarios</span></div><div className="demo-stat"><strong>{data.summary.provider_count}</strong><span>Providers</span></div><div className="demo-stat"><strong>{data.summary.step_count}</strong><span>Recorded steps</span></div></div>}
      </header>

      {loading && !data ? <div className="demo-skeleton" aria-label="Loading recorded workflows" /> : null}
      {error && <Alert><div className="row-between"><span>Could not load recorded demo workflows: {error}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => reload()}>Retry</button></div></Alert>}
      {data && (
        <>
          <Section title="Verification checklist" className="demo-filter-card">
            <div className="row-between"><span className="muted small">Snapshot generated {dateTime(data.generated_at)} · schema {data.schema_version}</span><span className="badge badge-success">Simulated: {data.simulated ? 'yes' : 'no'}</span></div>
            <div className="demo-checks">{data.checks.map((check) => <div className="demo-check" key={check.label}><span className={`demo-check-mark${check.passed ? '' : ' fail'}`} aria-hidden="true">{check.passed ? 'PASS' : 'CHECK'}</span><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>
          </Section>
          <Section title="Find a recorded scenario" className="demo-filter-card">
            <div className="demo-filter-grid">
              {FILTERS.map(({ key, label: filterLabel }) => <label className="field" key={key}><span className="field-label">{filterLabel}</span><select value={filters[key]} onChange={(event) => changeFilter(key, event.target.value)}><option value="">All {filterLabel.toLowerCase()}s</option>{options[key].map((option) => <option key={option} value={option}>{option}</option>)}</select></label>)}
              <button type="button" className="btn btn-secondary" onClick={() => { setFilters({ region: '', cadre: '', work_type: '', route: '', variant: '' }); setSelectedId(null); setStepIndex(0); }}>Clear filters</button>
            </div>
          </Section>
          {!filtered.length ? <div className="empty">No recorded scenarios match these filters. Clear one or more filters to see the available snapshots.</div> : (
            <div className="demo-layout">
              <Section title={`Scenario overview · ${filtered.length} shown`} className="demo-scenarios">
                <p className="small muted">All provider × work-type combinations in the selected set, with recorded final status.</p>
                <div className="demo-scenario-list">{filtered.map((scenario) => <button type="button" className="demo-scenario-option" aria-current={scenario.id === selected?.id} key={scenario.id} onClick={() => chooseScenario(scenario)}>
                  <span className="demo-scenario-title">{scenario.title}</span>
                  <span className="demo-scenario-meta"><span>{scenario.provider_label} · {scenario.cadre} · {scenario.work_type}</span><span className="badge badge-neutral">{finalStatus(scenario)}</span></span>
                  <span className="demo-scenario-meta"><span>{scenario.region} · Route {scenario.route} · {scenario.variant}</span><span>{scenario.steps.length} steps</span></span>
                </button>)}</div>
              </Section>
              {selected && step && <Section title="Recorded step viewer" className="demo-viewer">
                <div className="row-between"><div><h2>{selected.title}</h2><p className="muted small">{selected.provider_label} · {selected.cadre} · {selected.region}</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Reset to first step</button></div>
                <div className="demo-route-line"><span className="badge badge-route">Route {selected.route}</span><span className="badge badge-neutral">{selected.work_type}</span><span className="badge badge-neutral">{selected.variant}</span></div>
                <RouteNote route={selected.route} workType={selected.work_type} />
                <p className="small">{selected.description}</p>
                <div className="demo-progress" role="progressbar" aria-label="Scenario progress" aria-valuemin={1} aria-valuemax={selected.steps.length} aria-valuenow={stepIndex + 1}><span style={{ width: `${((stepIndex + 1) / selected.steps.length) * 100}%` }} /></div>
                <div className="demo-step-choices" role="group" aria-label="Jump to a recorded role step">{selected.steps.map((recordedStep, index) => <button type="button" className="demo-step-choice" aria-current={index === stepIndex ? 'step' : undefined} key={recordedStep.id} onClick={() => setStepIndex(index)} title={`${index + 1}. ${roleLabel(recordedStep.role)} — ${recordedStep.title}`}>{index + 1}. {roleLabel(recordedStep.role)}</button>)}</div>
                <div className="demo-step-nav">
                  <button type="button" className="btn btn-secondary" disabled={stepIndex === 0} onClick={() => setStepIndex((index) => Math.max(0, index - 1))}>Back</button>
                  <strong>Step {stepIndex + 1} of {selected.steps.length}</strong>
                  <button type="button" className="btn btn-primary" disabled={stepIndex >= selected.steps.length - 1} onClick={() => setStepIndex((index) => Math.min(selected.steps.length - 1, index + 1))}>Next</button>
                </div>
                <div className="stack" style={{ marginTop: '1rem' }}><StepDetail step={step} proofBusy={proofBusy} proofError={proofError} onDownloadProof={downloadSampleProof} /></div>
              </Section>}
            </div>
          )}
        </>
      )}
      {!loading && !error && !data && <Alert>Demo workflow data is unavailable. Retry to request the recorded snapshot.</Alert>}
    </div>
  );
}
