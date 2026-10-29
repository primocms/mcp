// Fingerprints are carried by both the record and its file name. Older clients
// replace files without updating the hash fields; checking both prevents reuse
// of a different artifact after such a publication (including edit/revert).
export function pageFileName(hash: string): string {
	return `p_${hash}.html`;
}

export function scriptFileName(hash: string, version: string): string {
	// PocketBase keeps up to 100 characters before adding its random suffix.
	// This base is 99 characters and preserves the complete output SHA-256.
	return `s_${hash.slice(0, 32)}_${version}.js`;
}

export function pageFileMatches(file: unknown, hash: string): boolean {
	return typeof file === "string" && /^[a-f0-9]{64}$/.test(hash) &&
		new RegExp(`^p_${hash}(?:_[a-z0-9]{10})?\\.html$`).test(file);
}

export function cachedScriptVersion(file: unknown, storedHash: unknown, hash: string): string | undefined {
	if (typeof file !== "string" || storedHash !== hash || !/^[a-f0-9]{64}$/.test(hash)) return;
	return new RegExp(`^s_${hash.slice(0, 32)}_([a-f0-9]{64})(?:_[a-z0-9]{10})?\\.js$`).exec(file)?.[1];
}
