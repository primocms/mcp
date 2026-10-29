import { getSchema, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Typography from "@tiptap/extension-typography";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import Highlight from "@tiptap/extension-highlight";
import { DOMSerializer } from "@tiptap/pm/model";
import { VHTMLDocument } from "zeed-dom";

// Match CMS src/lib/builder/rich-text/extensions.ts, including link defaults
// and the image, YouTube and highlight nodes accepted by its editor.
export const publishRichTextExtensions = [
	StarterKit.configure({ link: { openOnClick: false } }),
	Image,
	Youtube.configure({ modestBranding: true }),
	Typography,
	Highlight.configure({ multicolor: false })
];
const richTextSchema = getSchema(publishRichTextExtensions);

class PublishDocument extends VHTMLDocument {
	createElement(name: string) {
		const element = super.createElement(name);
		const setAttribute = element.setAttribute.bind(element);
		// Match HTML DOM setAttribute coercion; extension output includes boolean
		// iframe attributes, whose explicit "false" values must not disappear.
		element.setAttribute = (key: string, value: unknown) => setAttribute(key.toLowerCase(), String(value));
		return element;
	}
}

export function renderRichText(value: unknown): string {
	if (!value || typeof value !== "object" || !Array.isArray((value as JSONContent).content)) return "";
	// Use the same schema and ProseMirror serializer as the browser converter.
	// A local virtual document avoids global DOM state and preserves adjacent
	// marks exactly as CMS publishing does (including a link around bold text).
	const document = new PublishDocument();
	const node = richTextSchema.nodeFromJSON(value);
	return DOMSerializer.fromSchema(richTextSchema).serializeFragment(node.content, { document }).render();
}
