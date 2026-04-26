import type { DocSection } from "./docs.js";

export const listDocsTool = {
	name: "list_docs",
	description: "List available Primo reference documentation sections.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false
	},
	outputSchema: {
		type: "object",
		properties: {
			sections: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						title: { type: "string" },
						description: { type: "string" }
					},
					required: ["id", "title", "description"],
					additionalProperties: false
				}
			}
		},
		required: ["sections"],
		additionalProperties: false
	}
} as const;

export type ListDocsResult = {
	sections: DocSection[];
};

export function listDocs(sections: DocSection[]): ListDocsResult {
	return { sections };
}
