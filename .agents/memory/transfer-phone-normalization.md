---
name: Legacy phone formats in setup transfers
description: Preserving local-format Tanzania phone numbers while reconciling a strict E.164 setup export.
---

Normalize valid Tanzanian national mobile numbers (starting `06` or `07`) to `+255` in transfer documents and identity comparisons, but do not rewrite the stored phone on an existing account.

**Why:** Existing Live accounts can predate the strict international-format validation used by setup transfer. Rejecting them blocks a reviewed account match; changing the stored login number is unnecessary and could disrupt the account.

**How to apply:** At setup-import boundaries, compare both national and international representations of the same number. Preserve existing account identity values, credentials, roles, and login behavior unless the administrator explicitly changes them.
