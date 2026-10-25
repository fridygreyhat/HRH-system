---
name: Budget lock freshness
description: Why financial row locks must also refresh an already-loaded ORM instance
---

Budget balance checks must refresh the ORM instance when acquiring its database
row lock, even if it was read earlier in the same transaction.

**Why:** SQLAlchemy can return an already-loaded identity-map object without
replacing its attributes after another transaction commits. The database row is
locked, but a check against that stale object can still overwrite an earlier
commitment. A database ceiling check cannot catch two transactions overwriting
the balance with the same individually-valid absolute amount.

**How to apply:** Keep refresh-on-lock behavior for commitment, spending,
reallocation, and cap changes. Concurrency regressions must deliberately preload
the same balance in both sessions before competing for its lock; starting only
with fresh queries misses this failure mode.
