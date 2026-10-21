import fs from 'node:fs/promises'
import path from 'node:path'

export const LOG_READ_LIMIT = 256 * 1024

// This read-only protocol is also shipped in primo-mcp. Keep the paths and
// bounded tail behavior compatible across independently installed versions.
export async function find_dev_workspace(start: string): Promise<string> {
	const initial = path.resolve(start)
	let dir = initial
	while (true) {
		try { await fs.access(path.join(dir, 'server.yaml')); return dir } catch { /* walk up */ }
		const parent = path.dirname(dir)
		if (parent === dir) return initial // Legacy single-site workspace.
		dir = parent
	}
}

export async function read_dev_logs(start: string, lines = 100, previous = false) {
	if (!Number.isInteger(lines) || lines < 1 || lines > 1000) throw new Error('lines must be an integer from 1 to 1000')
	const workspace = await find_dev_workspace(start)
	const log_file = path.join(workspace, '.primo/dev.log') + (previous ? '.1' : '')
	let handle
	try {
		handle = await fs.open(log_file, 'r')
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		return { available: false, workspace, log_file, text: '', truncated: false, log_id: '', offset: 0 }
	}
	try {
		const stat = await handle.stat()
		const start = Math.max(0, stat.size - LOG_READ_LIMIT)
		const buffer = Buffer.alloc(stat.size - start)
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
		let text = buffer.subarray(0, bytesRead).toString('utf8')
		// Drop a partial first line/UTF-8 character when reading a bounded tail.
		if (start > 0) text = text.slice(text.indexOf('\n') + 1)
		const entries = text.replace(/\n$/, '').split('\n')
		return {
			available: true, workspace, log_file,
			text: entries.slice(-lines).join('\n') + (text ? '\n' : ''),
			truncated: start > 0 || entries.length > lines,
			log_id: `${stat.dev}:${stat.ino}`, offset: start + bytesRead
		}
	} finally { await handle.close() }
}
