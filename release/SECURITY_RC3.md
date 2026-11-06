# MCP security candidate RC.3

primo-mcp 0.1.11-rc.3 retains the compiler/runtime behavior from RC.2 and refreshes vulnerable dependency locks (body-parser, fast-uri, markdown-it and zod). Markdown's dependency floor is 14.3.3. Full npm audit is clean.

The build, protocol smoke suite against a disposable site, and all 19 runtime/image/link/cache/hydration/resolution regressions pass. CI adds strict audit and the Node 22.13.0/24.0.0 matrix. The exact local tarball is consumed by CLI RC.3 and the CMS RC.13 candidate in primocms/primo#1363. Final exact-package checks are required; RC.2 bytes are never relabeled.

No merge, tag, package publication or deployment is performed. A later authorized registry release must precede the CLI's final registry integrity refresh.
