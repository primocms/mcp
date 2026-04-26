import { readdir, readFile } from "node:fs/promises";

export type DocSection = {
	id: string;
	title: string;
	description: string;
};

const referenceDirectory = new URL("../reference/", import.meta.url);
const markdownExtension = ".md";

function sectionIdFromFilename(filename: string): string {
	return filename.slice(0, -markdownExtension.length);
}

function extractMetadata(id: string, markdown: string): DocSection {
	const normalized = markdown.replace(/\r\n/g, "\n");
	const title =
		normalized
			.split("\n")
			.find((line) => line.startsWith("# "))
			?.slice(2)
			.trim() || id;

	const description =
		normalized
			.split(/\n{2,}/)
			.map((paragraph) => paragraph.trim())
			.find((paragraph) => paragraph.length > 0 && !paragraph.startsWith("# ")) || "";

	return {
		id,
		title,
		description
	};
}

async function readMarkdownFile(section: string): Promise<string> {
	return readFile(new URL(`${section}${markdownExtension}`, referenceDirectory), "utf8");
}

export async function loadDocSections(): Promise<DocSection[]> {
	const filenames = await readdir(referenceDirectory);
	const markdownFiles = filenames
		.filter((filename) => filename.endsWith(markdownExtension))
		.sort((a, b) => a.localeCompare(b));

	const sections = await Promise.all(
		markdownFiles.map(async (filename) => {
			const id = sectionIdFromFilename(filename);
			const markdown = await readMarkdownFile(id);

			return extractMetadata(id, markdown);
		})
	);

	return sections;
}

export function createDocStore(sections: DocSection[]) {
	const sectionIds = new Set(sections.map((section) => section.id));

	return {
		sections,
		has(section: string): boolean {
			return sectionIds.has(section);
		},
		async read(section: string): Promise<string> {
			return readMarkdownFile(section);
		}
	};
}
