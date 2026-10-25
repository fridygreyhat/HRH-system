---
name: Payment-detail access
description: Why CSO Finance must not be restricted to bank-only access for all payments.
---

CSO Finance needs bank details for payroll and mobile-money details for its assigned community payments. FHI360 Finance sees mobile-money details for services. Providers manage their own payment details.

**Why:** The user explicitly chose the assigned-community exception over the attachment's blanket bank-only CSO restriction, because CSOs also disburse community claims.

**How to apply:** Authorize payment-detail reads using the actual assigned claim, channel and finance scope. Do not grant every CSO access to every mobile number, and do not remove community mobile access when tightening payroll bank privacy. Preserve existing approval, proof and independent reconciliation safeguards.

A provider-level finance view may legitimately include both channels when separate assigned payroll and community claims authorize each one. A payroll claim alone does not authorize wallet access; its payment-recipient view must remain bank-only.

**Why:** The assigned-community exception must continue to work when the same provider also has payroll, including records from different periods.
