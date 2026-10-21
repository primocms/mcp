import { read_dev_logs } from './read-dev-logs.js'
import { requireRecord, requireString } from './validation_schemas.js'

export type GetDevLogsInput = { site_path: string; lines?: number; previous?: boolean }

export const getDevLogsTool = {
	name: 'get_dev_logs',
	description: 'Read recent local CLI messages and CMS stdout/stderr from the workspace dev log, even after the server stops. Accepts a site or workspace path. Returns at most 1000 lines/256 KiB plus the full log file path; use previous=true for the previous rotated log. Call again for updated output, or use primo logs --follow in a terminal. Does not start a server.',
	inputSchema: {
		type: 'object',
		properties: {
			site_path: { type: 'string', description: 'Absolute path to the site export or workspace.' },
			lines: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
			previous: { type: 'boolean', default: false }
		},
		required: ['site_path'],
		additionalProperties: false
	}
} as const

export function readGetDevLogsInput(args: unknown): GetDevLogsInput {
	const record = requireRecord(args, getDevLogsTool.name)
	const site_path = requireString(record, 'site_path', getDevLogsTool.name)
	if (record.lines !== undefined && (!Number.isInteger(record.lines) || (record.lines as number) < 1 || (record.lines as number) > 1000)) {
		throw new Error('lines must be an integer from 1 to 1000')
	}
	if (record.previous !== undefined && typeof record.previous !== 'boolean') throw new Error('previous must be a boolean')
	return { site_path, lines: record.lines as number | undefined, previous: record.previous as boolean | undefined }
}

export async function getDevLogs(input: GetDevLogsInput) {
	return read_dev_logs(input.site_path, input.lines, input.previous)
}
