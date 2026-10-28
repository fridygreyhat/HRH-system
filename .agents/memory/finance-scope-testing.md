---
name: Finance scope testing
description: Isolating region, cadre and CSO boundaries in finance authorization tests.
---

Test finance scope boundaries one dimension at a time: a foreign-CSO actor must
have the same region and cadre grants before testing organization-based denial.
Verify actual assignments rather than assuming numbered finance users belong to
different organizations; they can be a same-CSO maker/checker pair.

**Why:** otherwise a denied request can pass for the wrong reason, or a valid
same-organization request can be mistaken for an access-control defect.

**How to apply:** use independently scoped actors for regional, cadre and
organization denial cases when adding finance reports or payment access checks.
