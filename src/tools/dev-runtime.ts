import fs from 'node:fs/promises'
import path from 'node:path'

// Runtime protocol shared with primo-cli/src/utils/dev-runtime.ts.
// Kept dependency-free so MCP can discover CLI sessions across package versions.
export const RUNTIME_FILE = '.primo/dev-server.json'

export interface DevRuntime {
	version: 1
	workspace: string
	pid: number
	cms_pid?: number
	port: number
	instance: string
}

export function process_is_alive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try { process.kill(pid, 0); return true } catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM'
	}
}

export function runtime_has_live_process(runtime: DevRuntime): boolean {
	return process_is_alive(runtime.pid) || (runtime.cms_pid !== undefined && process_is_alive(runtime.cms_pid))
}

export async function read_dev_runtime(dir: string): Promise<DevRuntime | null> {
	try {
		const value = JSON.parse(await fs.readFile(path.join(dir, RUNTIME_FILE), 'utf8'))
		if (value.version !== 1 || value.workspace !== await fs.realpath(dir)
			|| !Number.isInteger(value.port) || value.port < 1 || value.port > 65534
			|| !Number.isInteger(value.pid) || typeof value.instance !== 'string') return null
		return value
	} catch { return null }
}

export async function runtime_is_running(runtime: DevRuntime): Promise<boolean> {
	if (!process_is_alive(runtime.pid)) return false
	try {
		const response = await fetch(`http://127.0.0.1:${runtime.port + 1}/__primo/runtime`, { signal: AbortSignal.timeout(1000) })
		if (!response.ok) return false
		const identity = await response.json() as DevRuntime
		return identity.instance === runtime.instance && identity.workspace === runtime.workspace
	} catch { return false }
}

