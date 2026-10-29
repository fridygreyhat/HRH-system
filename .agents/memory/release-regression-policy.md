---
name: Release regression policy
description: Interpreting old finance regression failures after changes to the payment policy.
---

Some older acceptance cases describe retired Payroll pricing, budget commitments and per-unit Services payments. Do not restore those behaviors solely to make an old test pass.

**Why:** broad release verification encountered tests that failed before reaching their approval assertions because their setup still requested retired payment rates. Passing those tests unchanged would contradict the user's later policy.

**How to apply:** compare failures with the current payment policy in `replit.md`, update obsolete setup and expectations where appropriate, and keep current authorization/payment checks intact. Run affected modules together as well as targeted cases: isolated passes can hide shared-test-state pollution.
