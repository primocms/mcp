import { readFile, writeFile } from "node:fs/promises"

// Vendored from palacms/src/lib/builder/field-types/index.js. Re-copy when
// upstream changes; canonical source still lives in the palacms repo.
const FIELD_TYPES_SOURCE = new URL(
	"../vendor/field-types/index.js",
	import.meta.url
)
const SCHEMA_PATH = new URL(
	"../src/schemas/field.schema.json",
	import.meta.url
)

const source = await readFile(FIELD_TYPES_SOURCE, "utf-8")

// Match `id: '...'` entries inside the default-exported array. Skip commented
// lines so disabled types (e.g. user-form, color) don't bleed into the enum.
const ids = []
for (const line of source.split("\n")) {
	const trimmed = line.trim()
	if (trimmed.startsWith("//")) continue
	const match = trimmed.match(/^id:\s*['"]([^'"]+)['"]/)
	if (match) ids.push(match[1])
}

if (ids.length === 0) {
	throw new Error(
		`No field type ids parsed from ${FIELD_TYPES_SOURCE.pathname}`
	)
}

const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf-8"))
const previous = schema.$defs?.fieldType?.enum
if (!Array.isArray(previous)) {
	throw new Error("field.schema.json $defs.fieldType.enum is missing")
}

schema.$defs.fieldType.enum = ids

const next = JSON.stringify(schema, null, 2) + "\n"
await writeFile(SCHEMA_PATH, next, "utf-8")

const added = ids.filter((id) => !previous.includes(id))
const removed = previous.filter((id) => !ids.includes(id))
if (added.length || removed.length) {
	console.log(
		`field.schema.json fieldType enum updated: +[${added.join(", ")}] -[${removed.join(", ")}]`
	)
} else {
	console.log("field.schema.json fieldType enum already in sync")
}
