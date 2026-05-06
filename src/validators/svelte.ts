import { parse } from "svelte/compiler";

import type { ValidationError, ValidationLocation } from "./types.js";
import { lineColFromOffset } from "./yaml.js";

type AstRecord = Record<string, unknown>;

export type DataKeyReference = {
	name: string;
	location?: ValidationLocation;
};

export function validateSvelte5Syntax(component: string, file: string): ValidationError[] {
	const parsed = parseSvelte(component, file);
	if (!parsed.ok) {
		return [parsed.error];
	}

	const errors: ValidationError[] = [];
	const instance = getRecord(parsed.ast, "instance");
	const html = getRecord(parsed.ast, "html") ?? getRecord(parsed.ast, "fragment");

	if (html) {
		walkAst(html, (node) => {
			if (node.type === "OnDirective") {
				const eventName = typeof node.name === "string" ? node.name : "event";
				errors.push({
					file,
					severity: "error",
					message: `Svelte 5 does not use on:${eventName} directives in Primo blocks.`,
					fix_hint: `Use on${eventName}={...} instead of on:${eventName}={...}.`,
					location: locationFromNode(component, node)
				});
			}
		});
	}

	if (instance) {
		walkAst(instance, (node) => {
			if (node.type === "ExportNamedDeclaration" && isLetDeclaration(getRecord(node, "declaration"))) {
				errors.push({
					file,
					severity: "error",
					message: "Svelte 5 block scripts should not use export let.",
					fix_hint: "Use let { field_name } = $props() for explicit props, or use Primo field names directly.",
					location: locationFromNode(component, node)
				});
			}

			if (node.type === "LabeledStatement" && getRecord(node, "label")?.name === "$") {
				errors.push({
					file,
					severity: "error",
					message: "Svelte 5 block scripts should not use reactive $: statements.",
					fix_hint: "Use $derived(...) for computed values or $effect(...) for side effects.",
					location: locationFromNode(component, node)
				});
			}
		});
	}

	return errors;
}

export function validateSiteHead(component: string, file: string): ValidationError[] {
	const parsed = parseSvelte(component, file);
	if (!parsed.ok) {
		return [parsed.error];
	}

	const errors: ValidationError[] = [];
	const fragment = getRecord(parsed.ast, "fragment") ?? getRecord(parsed.ast, "html");
	const nodes = fragment && Array.isArray(fragment.nodes) ? fragment.nodes : [];

	for (const node of nodes) {
		if (isRecord(node) && node.type === "SvelteHead") {
			errors.push({
				file,
				severity: "error",
				message: `${file} contains a <svelte:head> wrapper. This file is injected into <svelte:head> by Primo; the wrapper produces nested <svelte:head> tags and import will fail.`,
				fix_hint: "Remove the <svelte:head>...</svelte:head> wrapper and keep only its children (e.g. <title>, <meta>, <link>, <script>, <style>).",
				location: locationFromNode(component, node)
			});
		}
	}

	errors.push(...validateSvelte5Syntax(component, file));
	return errors;
}

export function extractPropsDestructureNames(component: string): string[] {
	const parsed = parseSvelte(component, "component.svelte");
	if (parsed.ok) {
		const names = new Set<string>();
		const instance = getRecord(parsed.ast, "instance");

		if (instance) {
			walkAst(instance, (node) => {
				if (node.type !== "VariableDeclaration" || node.kind !== "let") {
					return;
				}

				const declarations = Array.isArray(node.declarations) ? node.declarations : [];
				for (const declaration of declarations) {
					if (!isRecord(declaration) || !isPropsCall(getRecord(declaration, "init"))) {
						continue;
					}

					const id = getRecord(declaration, "id");
					if (id?.type === "ObjectPattern") {
						for (const name of namesFromObjectPattern(id)) {
							names.add(name);
						}
					}
				}
			});
		}

		return [...names];
	}

	return extractPropsDestructureNamesWithRegex(component);
}

export function extractDataKeyReferences(component: string): DataKeyReference[] {
	const references: DataKeyReference[] = [];
	const pattern = /(?:^|[\s<])data-key\s*=\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(component)) !== null) {
		const name = match[1];
		if (!name) {
			continue;
		}

		const offset = match.index + match[0].indexOf("data-key");
		references.push({
			name,
			location: lineColFromOffset(component, offset)
		});
	}

	return references;
}

function parseSvelte(
	component: string,
	file: string
):
	| {
			ok: true;
			ast: unknown;
	  }
	| {
			ok: false;
			error: ValidationError;
	  } {
	try {
		return {
			ok: true,
			ast: parse(component, { modern: true })
		};
	} catch (error) {
		const svelteError = error as {
			message?: string;
			start?: { line?: number; column?: number };
			position?: [number, number];
		};

		const fromStart =
			typeof svelteError.start?.line === "number" && typeof svelteError.start.column === "number"
				? {
						line: svelteError.start.line,
						col: svelteError.start.column + 1
					}
				: undefined;

		const fromOffset = Array.isArray(svelteError.position)
			? lineColFromOffset(component, svelteError.position[0])
			: undefined;

		return {
			ok: false,
			error: {
				file,
				severity: "error",
				message: `Could not parse component.svelte: ${svelteError.message ?? "Svelte parse failed"}`,
				fix_hint: "Fix the Svelte syntax, then run validation again.",
				location: fromStart ?? fromOffset
			}
		};
	}
}

function isRecord(value: unknown): value is AstRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(parent: unknown, key: string): AstRecord | undefined {
	if (!isRecord(parent)) {
		return undefined;
	}

	const value = parent[key];
	return isRecord(value) ? value : undefined;
}

function isLetDeclaration(node: AstRecord | undefined): boolean {
	return node?.type === "VariableDeclaration" && node.kind === "let";
}

function isPropsCall(node: AstRecord | undefined): boolean {
	if (!node || node.type !== "CallExpression") {
		return false;
	}

	const callee = getRecord(node, "callee");
	return callee?.type === "Identifier" && callee.name === "$props";
}

function namesFromObjectPattern(pattern: AstRecord): string[] {
	const names: string[] = [];
	const properties = Array.isArray(pattern.properties) ? pattern.properties : [];

	for (const property of properties) {
		if (!isRecord(property) || property.type === "RestElement") {
			continue;
		}

		const key = getRecord(property, "key");
		if (key?.type === "Identifier" && typeof key.name === "string") {
			names.push(key.name);
			continue;
		}

		if (key?.type === "Literal" && typeof key.value === "string" && isIdentifier(key.value)) {
			names.push(key.value);
		}
	}

	return names;
}

function extractPropsDestructureNamesWithRegex(component: string): string[] {
	const names = new Set<string>();
	const pattern = /let\s*{([\s\S]*?)}\s*=\s*\$props\s*\(/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(component)) !== null) {
		const body = match[1] ?? "";
		for (const part of splitTopLevel(body)) {
			const trimmed = part.trim();
			if (trimmed.length === 0 || trimmed.startsWith("...")) {
				continue;
			}

			const beforeDefault = trimmed.split("=")[0]?.trim() ?? "";
			const beforeAlias = beforeDefault.split(":")[0]?.trim() ?? "";
			const name = beforeAlias.match(/[A-Za-z_][A-Za-z0-9_]*/)?.[0];

			if (name && isIdentifier(name)) {
				names.add(name);
			}
		}
	}

	return [...names];
}

function splitTopLevel(value: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;

	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char === "{" || char === "[" || char === "(") {
			depth += 1;
		} else if (char === "}" || char === "]" || char === ")") {
			depth = Math.max(0, depth - 1);
		} else if (char === "," && depth === 0) {
			parts.push(value.slice(start, index));
			start = index + 1;
		}
	}

	parts.push(value.slice(start));
	return parts;
}

function isIdentifier(value: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function locationFromNode(component: string, node: AstRecord): ValidationLocation | undefined {
	return lineColFromOffset(component, typeof node.start === "number" ? node.start : undefined);
}

function walkAst(value: unknown, visit: (node: AstRecord) => void): void {
	const seen = new WeakSet<object>();

	function walk(current: unknown) {
		if (Array.isArray(current)) {
			for (const item of current) {
				walk(item);
			}
			return;
		}

		if (!isRecord(current) || seen.has(current)) {
			return;
		}

		seen.add(current);
		visit(current);

		for (const [key, child] of Object.entries(current)) {
			if (key === "parent") {
				continue;
			}
			walk(child);
		}
	}

	walk(value);
}
