export const getDocsTool = {
	name: "get_docs",
	description: "Read one Primo reference documentation section as markdown.",
	inputSchema: {
		type: "object",
		properties: {
			section: {
				type: "string",
				description: "The documentation section id returned by list_docs."
			}
		},
		required: ["section"],
		additionalProperties: false
	},
	outputSchema: {
		type: "object",
		properties: {
			section: { type: "string" },
			markdown: { type: "string" }
		},
		required: ["section", "markdown"],
		additionalProperties: false
	}
} as const;

export type GetDocsResult = {
	section: string;
	markdown: string;
};
