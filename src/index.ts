#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError
} from "@modelcontextprotocol/sdk/types.js";

import { createDocStore, loadDocSections } from "./tools/docs.js";
import { getDocsTool } from "./tools/get_docs.js";
import { listDocs, listDocsTool } from "./tools/list_docs.js";
import {
	readResolveFieldValueInput,
	resolveFieldValue,
	resolveFieldValueTool
} from "./tools/resolve_field_value.js";
import {
	readScaffoldBlockInput,
	readScaffoldPageTypeInput,
	scaffoldBlock,
	scaffoldBlockTool,
	scaffoldPageType,
	scaffoldPageTypeTool
} from "./tools/scaffold.js";
import { readValidateBlockInput, validateBlock, validateBlockTool } from "./tools/validate_block.js";
import { readValidatePageInput, validatePage, validatePageTool } from "./tools/validate_page.js";
import { buildPreview, buildPreviewTool, readBuildPreviewInput } from "./tools/build_preview.js";

const serverInstructions =
	"This is the official Primo MCP server. It MUST be used whenever working in a Primo site export (any directory containing site.yaml, blocks/, pages/, page-types/). Run list_docs first to discover available reference sections. After editing any block file (component.svelte, fields.yaml, content.yaml), call validate_block and address every error before reporting work as done. After editing a pages/*.yaml or page-types/*/config.yaml, call validate_page. When given a raw value for a field, call resolve_field_value to get the canonical shape. When creating a new block or page type, prefer scaffold_block / scaffold_page_type over hand-writing files - the scaffolders produce files that are guaranteed to pass validate_block / validate_page. To verify a change rendered visually, call build_preview after `primo dev` reports it imported the file change, then load the returned site_url.";

function jsonText(value: unknown) {
	return JSON.stringify(value, null, 2);
}

const docStore = createDocStore(await loadDocSections());

const server = new Server(
	{
		name: "@primo/mcp",
		version: "0.1.0"
	},
	{
		capabilities: {
			tools: {}
		},
		instructions: serverInstructions
	}
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		listDocsTool,
		getDocsTool,
		validateBlockTool,
		validatePageTool,
		resolveFieldValueTool,
		scaffoldBlockTool,
		scaffoldPageTypeTool,
		buildPreviewTool
	]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;

	if (name === listDocsTool.name) {
		const result = listDocs(docStore.sections);

		return {
			content: [{ type: "text", text: jsonText(result) }],
			structuredContent: result
		};
	}

	if (name === getDocsTool.name) {
		const section = args?.section;

		if (typeof section !== "string" || section.length === 0) {
			throw new McpError(
				ErrorCode.InvalidParams,
				'get_docs requires a non-empty string argument named "section". Call list_docs first to discover available sections.'
			);
		}

		if (!docStore.has(section)) {
			throw new McpError(
				ErrorCode.InvalidParams,
				`Unknown docs section "${section}". Call list_docs first to discover available sections.`
			);
		}

		const result = {
			section,
			markdown: await docStore.read(section)
		};

		return {
			content: [{ type: "text", text: jsonText(result) }],
			structuredContent: result
		};
	}

	if (name === validateBlockTool.name) {
		const result = validateBlock(readToolInput(readValidateBlockInput, args, validateBlockTool.name));

		return {
			content: [{ type: "text", text: jsonText(result) }],
			structuredContent: result
		};
	}

	if (name === validatePageTool.name) {
		const result = validatePage(readToolInput(readValidatePageInput, args, validatePageTool.name));

		return {
			content: [{ type: "text", text: jsonText(result) }],
			structuredContent: result
		};
	}

	if (name === resolveFieldValueTool.name) {
		const result = resolveFieldValue(readToolInput(readResolveFieldValueInput, args, resolveFieldValueTool.name));

		return {
			content: [{ type: "text", text: jsonText(result) }],
			structuredContent: result
		};
	}

	if (name === scaffoldBlockTool.name) {
		const result = scaffoldBlock(readToolInput(readScaffoldBlockInput, args, scaffoldBlockTool.name));

		return {
			content: [{ type: "text", text: jsonText(result) }],
			structuredContent: result
		};
	}

	if (name === scaffoldPageTypeTool.name) {
		const result = scaffoldPageType(readToolInput(readScaffoldPageTypeInput, args, scaffoldPageTypeTool.name));

		return {
			content: [{ type: "text", text: jsonText(result) }],
			structuredContent: result
		};
	}

	if (name === buildPreviewTool.name) {
		const input = readToolInput(readBuildPreviewInput, args, buildPreviewTool.name);
		try {
			const result = await buildPreview(input);
			return {
				content: [{ type: "text", text: jsonText(result) }],
				structuredContent: result
			};
		} catch (error) {
			throw new McpError(
				ErrorCode.InternalError,
				error instanceof Error ? error.message : `build_preview failed.`
			);
		}
	}

	throw new McpError(ErrorCode.MethodNotFound, `Unknown tool "${name}".`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

function readToolInput<T>(reader: (args: unknown) => T, args: unknown, toolName: string): T {
	try {
		return reader(args);
	} catch (error) {
		throw new McpError(
			ErrorCode.InvalidParams,
			error instanceof Error ? error.message : `Invalid arguments for ${toolName}.`
		);
	}
}
