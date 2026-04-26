export const validationOutputSchema = {
	type: "object",
	properties: {
		ok: { type: "boolean" },
		errors: {
			type: "array",
			items: {
				type: "object",
				properties: {
					file: { type: "string" },
					severity: { type: "string", enum: ["error", "warning"] },
					message: { type: "string" },
					fix_hint: { type: "string" },
					location: {
						type: "object",
						properties: {
							line: { type: "integer", minimum: 1 },
							col: { type: "integer", minimum: 1 }
						},
						required: ["line", "col"],
						additionalProperties: false
					}
				},
				required: ["file", "severity", "message"],
				additionalProperties: false
			}
		}
	},
	required: ["ok", "errors"],
	additionalProperties: false
} as const;

export function requireRecord(value: unknown, toolName: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError(`${toolName} requires an object argument.`);
	}

	return value as Record<string, unknown>;
}

export function requireString(record: Record<string, unknown>, key: string, toolName: string): string {
	const value = record[key];
	if (typeof value !== "string") {
		throw new TypeError(`${toolName} requires a string argument named "${key}".`);
	}

	return value;
}
