---
name: Imported frontend compatibility
description: Build-tool compatibility and why the unsupported CRA dependency tree must not return.
---

Keep TypeScript and Node type declarations compatible across the root npm
workspace and standalone frontend installs. Do not reintroduce react-scripts
as a shortcut for build or test compatibility.

**Why:** The imported CRA dependency tree could not resolve its security
findings through compatible parent upgrades. Its replacement deliberately
upgraded TypeScript instead of forcing new tooling to consume obsolete Node
typings. A leaf package's overrides do not control root workspace installs.

**How to apply:** Check resolved typings and run type checks, frontend tests and
the production build after dependency changes. Preserve security floors in
both workspace and standalone manifests. Jest's abstract jsdom environment has
a broad peer range that can retain an old installed jsdom despite a Jest
upgrade; keep its peer resolution aligned with the main Jest environment.
