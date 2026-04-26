import { cp, rm } from "node:fs/promises";

for (const directory of ["reference", "schemas"]) {
	await rm(new URL(`../dist/${directory}`, import.meta.url), {
		force: true,
		recursive: true
	});

	await cp(
		new URL(`../src/${directory}`, import.meta.url),
		new URL(`../dist/${directory}`, import.meta.url),
		{ recursive: true }
	);
}
