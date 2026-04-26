export type ValidationSeverity = "error" | "warning";

export type ValidationLocation = {
	line: number;
	col: number;
};

export type ValidationError = {
	file: string;
	severity: ValidationSeverity;
	message: string;
	fix_hint?: string;
	location?: ValidationLocation;
};

export type ValidationResult = {
	ok: boolean;
	errors: ValidationError[];
};

export type FieldType =
	| "repeater"
	| "group"
	| "text"
	| "rich-text"
	| "markdown"
	| "link"
	| "image"
	| "icon"
	| "url"
	| "page-field"
	| "site-field"
	| "page"
	| "page-list"
	| "number"
	| "date"
	| "slider"
	| "switch"
	| "select"
	| "info";

export type FieldDefinition = {
	name: string;
	type: FieldType | string;
	label?: string;
	config?: unknown;
	options?: unknown;
	subfields?: FieldDefinition[];
};

export function resultFromErrors(errors: ValidationError[]): ValidationResult {
	return {
		ok: !errors.some((error) => error.severity === "error"),
		errors
	};
}
