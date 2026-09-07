// Regression test for hoisted-install Svelte resolution (#7, #10).
//
// build_preview compiles user components with esbuild. When this package is
// installed hoisted (npx), esbuild's default walk-up from the package root can
// land on a missing or partial svelte copy whose export map points at files
// that don't exist ("Cannot read file: .../svelte/src/index-client.js") —
// while the copy Node itself loads is fine. publish_compiler pins svelte
// imports to Node's copy (SVELTE_PACKAGE_DIR + a build.resolve redirect);
// this test bundles through the real code path with a deliberately poisoned
// resolve root and fails if that redirect ever regresses.
//
// Run `npm run build` first (imports from dist/), then `npm run test:resolution`.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { render } from "svelte/server";

import { bundleVirtualProject } from "../dist/tools/publish_compiler.js";

const require = createRequire(import.meta.url);

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

// Poisoned layout: a svelte dir with a real package.json but no src/. Any
// resolver that walks up from here matches svelte's export map, then fails to
// read the target file — the exact hoisted-install failure mode.
const poisonedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "primo-resolution-"));
const brokenSvelte = path.join(poisonedRoot, "node_modules", "svelte");
await fs.mkdir(brokenSvelte, { recursive: true });
await fs.copyFile(require.resolve("svelte/package.json"), path.join(brokenSvelte, "package.json"));

try {
	// Control: default resolution from the poisoned root must fail. If svelte
	// ever stops shipping an export map this fixture can trip, the poison stops
	// poisoning and the assertions below would pass vacuously.
	const controlError = await esbuild
		.build({
			stdin: { contents: "import 'svelte';", resolveDir: poisonedRoot },
			bundle: true,
			platform: "browser",
			write: false,
			logLevel: "silent"
		})
		.then(
			() => null,
			(error) => error
		);
	assert(controlError, "Control failed: the poisoned svelte copy no longer breaks default resolution.");

	const component = `<h1 data-key="heading">{heading}</h1>
<script>
let { heading } = $props();
</script>`;
	const tempDir = path.join(poisonedRoot, "out");
	await fs.mkdir(tempDir, { recursive: true });

	// Client bundle: browser platform must reach the real svelte's client entry
	// through the redirect even though the walk-up path is poisoned.
	const clientJs = await bundleVirtualProject({
		files: new Map([
			["./entry.js", "export { default } from './App.svelte';\nexport { hydrate } from 'svelte';"],
			["./App.svelte", component]
		]),
		svelteOptions: { generate: "client", css: "external", runes: true },
		platform: "browser",
		tempDir,
		packageRoot: poisonedRoot
	});
	assert(clientJs.includes("hydrate"), "Client bundle did not include the hydrate export.");
	console.log("client bundle from poisoned root: ok");

	// Server bundle: node platform must get the server entry, and the output
	// must actually run — SSR render proves the bundle is coherent end to end.
	const serverJs = await bundleVirtualProject({
		files: new Map([
			["./entry.js", "export { default } from './App.svelte';"],
			["./App.svelte", component]
		]),
		svelteOptions: { generate: "server", css: "injected", runes: true },
		platform: "node",
		tempDir,
		packageRoot: poisonedRoot
	});
	const bundlePath = path.join(tempDir, "server.mjs");
	await fs.writeFile(bundlePath, serverJs);
	const bundle = await import(pathToFileURL(bundlePath).href);
	const rendered = render(bundle.default, { props: { heading: "resolution works" } });
	assert(rendered.body.includes("resolution works"), "SSR output did not include the rendered prop.");
	console.log("server bundle + SSR render from poisoned root: ok");

	console.log("svelte resolution regression test: ok");
} finally {
	await fs.rm(poisonedRoot, { recursive: true, force: true }).catch(() => {});
}
