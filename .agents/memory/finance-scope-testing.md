---
name: Finance scope testing
description: Isolating authorization boundaries and calendar-month data in finance tests.
---

Test finance scope boundaries one dimension at a time: a foreign-CSO actor must
have the same region and cadre grants before testing organization-based denial.
Verify actual assignments rather than assuming numbered finance users belong to
different organizations; they can be a same-CSO maker/checker pair.

**Why:** otherwise a denied request can pass for the wrong reason, or a valid
same-organization request can be mistaken for an access-control defect.

**How to apply:** use independently scoped actors for regional, cadre and
organization denial cases when adding finance reports or payment access checks.

Monthly finance assertions must account for legitimate approved work from other
pay periods in the same calendar month. Capture a baseline before adding records
that cross a month boundary, or isolate the calendar month completely.

**Why:** shared fixtures can put earlier cases' work in the adjacent month.
Excluding that work to satisfy a test would break the actual monthly report.

**How to apply:** compare the expected increase over the baseline when a test
adds next-month entries; do not weaken the report to filter only its test period.
