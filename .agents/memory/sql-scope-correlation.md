---
name: SQL scope correlation
description: SQLAlchemy auto-correlation hazards when reusing finance authorization filters.
---

Finance scope predicates contain correlated work-log/cadre lookups. Do not add an unaliased outer work-log join merely to filter claims when the scope predicate already supplies that lookup.

**Why:** SQLAlchemy can auto-correlate the nested lookup against the outer join and remove all of its FROM clauses. The authorized finance query then fails during compilation rather than returning a scoped result.

**How to apply:** Avoid unnecessary joins; if a work-log join is genuinely needed, use an appropriate alias or explicit correlation boundaries. Exercise the full scope-bearing query against PostgreSQL, not only a mocked query builder.
