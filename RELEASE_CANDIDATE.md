# MCP 0.1.11-rc.2 — draft release candidate

Integrates #29's repeated-section hydration fix with upstream's versioned publish cache. Preserves the `primo-mcp/compiler` export, rendered head, CSS, and empty-page metadata.

Build with Node 22: `npm ci` then `npm pack`. This is a local candidate; no npm publication or tag is authorized. Review/merge #29 separately before preparing the eventual stable release.

Proposed release order: corrected MCP package, CMS candidate, CLI candidate pinned to that exact MCP version, packaged handoff, authorized CMS availability, CLI availability. CMS release publication triggers deployment; keep it draft.

RC.2 raises security dependency floors and refreshes the compatible dependency lock. Full npm audit is clean. Local packages only; no publication is authorized.
