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

Do not promise that ordinary republishing will copy Preview records into an already-existing Production database.

**Why:** initial data-copy settings and existing-database publishing are different flows; contradictory documentation summaries led to repeated successful code publishes while required Live accounts were still absent.

**How to apply:** verify the current publishing UI and initial-copy availability before offering that route. For an existing empty database, treat missing accounts and roles as explicit data provisioning, not a password or code-release problem.

Before giving manual Production restore instructions, check whether the owner's database interface permits modifications.

**Why:** a valid restore statement was refused by the interface's modification restriction; changing the statement or stopping the published app does not establish write permission.

**How to apply:** consult the current database documentation for the Production editing control, and keep owner-run edits distinct from the agent's read-only Production replica access. Never claim a restore succeeded until Live records are verified.
