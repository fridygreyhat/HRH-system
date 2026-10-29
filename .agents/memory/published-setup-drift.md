---
name: Published setup drift
description: Distinguishing stale application code from missing live configuration.
---

When changes appear missing after publishing, compare the actual JS/CSS asset bytes and API behavior before assuming stale browser caches. If they match, compare the live and preview setup records read-only.

**Why:** an investigation found identical live/preview application assets while account access, placements, programmes and rates existed only in preview. Repeated cache clearing or republishing code would not restore that setup.

**How to apply:** keep setup correction separate from code publishing. Follow the reviewed missing-only transfer policy in `replit.md`; never replace live work, approvals, payments or credentials with preview data.

A readable production database replica does not by itself establish that a Live application is currently reachable.

**Why:** an account-cleanup investigation could read production records while deployment metadata reported no active publication and the previously supplied Live API returned 404.

**How to apply:** verify the current published URL and application identity before attempting authorized Live changes. Do not redirect production writes into Preview or treat a successful production SELECT as evidence that a Live mutation succeeded.
