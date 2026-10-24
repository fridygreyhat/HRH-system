---
name: Imported frontend compatibility
description: Why dependency installs must preserve the imported CRA frontend's older Node typings.
---

Keep Node type declarations compatible with the imported TypeScript 4.9 frontend.
When npm installs through a workspace root, do not rely on a leaf package's
overrides to enforce that compatibility.

**Why:** The frontend build can succeed while a standalone TypeScript check
fails because newer Node typings contain syntax TypeScript 4.9 cannot parse.
The imported frontend's leaf-level override was not sufficient when installed
through a root npm workspace.

**How to apply:** After changing frontend dependency installation or workspace
configuration, check the resolved Node typings and run the standalone TypeScript
check as well as the CRA build. Preserve compatible typings unless deliberately
upgrading the compiler and verifying the full frontend.
