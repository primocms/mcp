import { load, type YAMLException } from "js-yaml";

import type { ValidationError } from "./types.js";

export type ParsedYaml =
	| {
			ok: true;
			value: unknown;
	  }
	| {
			ok: false;
			error: ValidationError;
	  };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseYamlDocument(source: string, file: string): ParsedYaml {
	try {
		return {
			ok: true,
			value: load(source) ?? {}
		};
	} catch (error) {
		const yamlError = error as YAMLException;
		const location = yamlError.mark
			? {
					line: yamlError.mark.line + 1,
					col: yamlError.mark.column + 1
				}
			: undefined;

		return {
			ok: false,
			error: {
				file,
				severity: "error",
				message: `Could not parse ${file}: ${yamlError.message}`,
				fix_hint: "Fix the YAML syntax, then run validation again.",
				location
			}
		};
	}
}

export function describeValueType(value: unknown): string {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	return typeof value;
}

export function lineColFromOffset(source: string, offset: number | undefined): { line: number; col: number } | undefined {
	if (typeof offset !== "number" || offset < 0) {
		return undefined;
	}

	let line = 1;
	let lineStart = 0;
	for (let index = 0; index < offset && index < source.length; index += 1) {
		if (source[index] === "\n") {
			line += 1;
			lineStart = index + 1;
		}
	}

	return {
		line,
		col: offset - lineStart + 1
	};
}
