import React from 'react';

/** Instructions only: never impersonates another role or exposes their records. */
export function ApprovalFinanceGuide() {
  return <details className="card">
    <summary><strong>How Services and Payroll move through approval and payment</strong></summary>
    <div className="stack">
      <p>Payroll: Provider → CTC → Technical → RM → monthly report. Services: Provider → CTC → Technical → RM → Regional Finance → FHI360 → payment, proof and reconciliation.</p>
      <p>Services and Payroll are separate records, separate review lists and separate approvals. Approving one does not approve the other.</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Role / screen</th><th>What appears</th><th>Next action</th></tr></thead>
        <tbody>
          <tr><td>CTC In-Charge · Work log reviews</td><td>Services or Payroll submitted by CHWs, HCPs and Data Clerks at the assigned facility.</td><td>Select Services or Payroll, open the record, review and verify. Each record then goes to Technical.</td></tr>
          <tr><td>Technical · Work log reviews</td><td>CTC-verified Services or Payroll within the assigned region and cadre scope.</td><td>Review and endorse each record, or return it for correction. Endorsed records go to RM.</td></tr>
          <tr><td>RM · Work log reviews</td><td>All cadres in the assigned regions. All visible logs tracks progress; Waiting on me lists records ready for RM.</td><td>Select Services or Payroll and authorize each Technical-endorsed record separately.</td></tr>
          <tr><td>Regional Finance · Monthly report / Services routing</td><td>Monthly indicators and hours for assigned cadres. Services and Payroll remain separate.</td><td>Payroll is report-only after RM approval. For Services, select PnP, Supply Chain or EpiC, confirm the fixed daily amount preview and route to the eligible payor. The highest eligible service amount per day applies.</td></tr>
          <tr><td>FHI360 Finance · Payment claims</td><td>Services routed to FHI360 within the finance user’s scope, with amount, payment status, proof and recipient details.</td><td>Review the routed claim, record externally completed payment, attach proof and reconcile. No money transfer is initiated here.</td></tr>
          <tr><td>Community claims · assigned CSO Finance</td><td>Provider-submitted period totals priced using approved community rates, after scoped community verification.</td><td>Independent path: provider → community verifier → assigned CSO approval → external payment, proof and reconciliation. No RM, Regional Finance or regional budget allocation is required. Historical committed records remain visible.</td></tr>
        </tbody>
      </table></div>
      <p className="notice notice-info">Payroll approval confirms work, not payment. Services review confirms the funding source and fixed amount per service day; payment, proof and reconciliation remain explicit downstream steps. Community claims follow their separate independent CSO approval and proof path.</p>
      <p className="muted small">This guide describes the workflow, not demo transactions or completed approvals. “Central Finance” here means the FHI360 Finance role, not Central Admin. Role permissions and assigned scopes still apply; full audit trails remain admin-only.</p>
    </div>
  </details>;
}
