---
name: Demo boundaries
description: The user's approval for simulated demonstrations does not authorize real SMS, transfers or changes to existing financial records.
---

The user explicitly approved isolated simulated demos of provider-to-payment
workflows. Keep demonstration actions separate from existing financial records
and real SMS delivery. Do not present successful simulated transitions as proof
that the live external integrations work.

**Why:** The user chose simulated SMS confirmation and sample payments while
Vodacom acceptance remained unconfirmed.

**How to apply:** Preserve this distinction when expanding demos, explaining
verification results or preparing training. A real SMS test or external payment
is a separate action, not implied by permission to demonstrate the workflow.

For Preview workflow demonstrations, suppress outbound notifications and stop
sample claims at finance-ready/routed status. Do not create payment records or
payment proofs for a simulation.

**Why:** Review, routing and export can be demonstrated without contacting
providers or representing simulated funds as paid.

**How to apply:** Keep Preview demo records clearly labeled, use role-authorized
workflow transitions, and verify that SMS and payment records remain untouched.
