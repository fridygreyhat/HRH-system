import React from 'react';

/** Instructions only: never impersonates another role or exposes their records. */
export function ApprovalFinanceGuide() {
  return <details className="card">
    <summary><strong>How Services and Payroll move through approval and payment</strong></summary>
    <div className="stack">
      <p>Payroll: Provider submission → CTC verification → Technical review → RM approval → monthly finance report. Services continues through Regional Finance review and payment routing.</p>
      <p>Services and Payroll are separate records, separate review lists and separate approvals. Approving one does not approve the other.</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Role / screen</th><th>What appears</th><th>Next action</th></tr></thead>
        <tbody>
          <tr><td>CTC In-Charge · Work log reviews</td><td>Services or Payroll submitted by CHWs, HCPs and Data Clerks at the assigned facility.</td><td>Select Services or Payroll, open the record, review and verify. Each record then goes to Technical.</td></tr>
          <tr><td>Technical · Work log reviews</td><td>CTC-verified Services or Payroll within the assigned region and cadre scope.</td><td>Review and endorse each record, or return it for correction. Endorsed records go to RM.</td></tr>
          <tr><td>RM · Work log reviews</td><td>All cadres in the assigned regions. All visible logs tracks progress; Waiting on me lists records ready for RM.</td><td>Select Services or Payroll and authorize each Technical-endorsed record separately.</td></tr>
          <tr><td>Regional Finance · Monthly report / Services routing</td><td>Monthly indicators and hours for all assigned cadres together. Services and Payroll are separate report selections.</td><td>Payroll is report-only after RM approval: no rates, budget or finance approval. Services requires amount and budget validation before routing to FHI360.</td></tr>
          <tr><td>CSO Finance · Monthly report / CSO payments</td><td>Approved monthly work in the assigned region, cadre and CSO scope, plus authorized community claims and historical payments.</td><td>Payroll reporting requires no finance approval or budget. Existing financial history remains intact. Assigned community payments may use mobile money.</td></tr>
          <tr><td>Central / FHI360 Finance · Payment claims</td><td>Services routed to FHI360 within the finance user’s region and cadre scope, with amount, claim status, payment status, proof and recipient details.</td><td>Pay externally, record the payment and attach proof. Services use mobile money. Legacy Payroll batches retain their existing workflow.</td></tr>
        </tbody>
      </table></div>
      <p className="notice notice-info">Payroll approval confirms work, not payment. Services still requires approved amounts, an eligible budget and the correct scope; a separate eligible user reconciles payments.</p>
      <p className="muted small">This guide describes the workflow, not demo transactions or completed approvals. “Central Finance” here means the FHI360 Finance role, not Central Admin. Role permissions and assigned scopes still apply; full audit trails remain admin-only.</p>
    </div>
  </details>;
}
