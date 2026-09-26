/**
 * Text parsing shared by the dashboard's remote forms and the components that
 * display the same shapes. Lives outside `*.remote.ts` on purpose: it is pure
 * and isomorphic — the server parses submitted textarea/input strings with it,
 * the client uses it for live previews (e.g. the `always` tag toggle).
 */

/** Split a textarea into non-empty trimmed lines. */
export function lines(text: string): string[] {
	return text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
}

/** "a, b ,C" → ['a', 'b', 'c'] — trimmed, lowercased, hyphenated. */
export function parseTags(text: string): string[] {
	return text
		.split(',')
		.map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
		.filter(Boolean);
}

/** "Name:type:summary" per line — type defaults to concept. */
export function parseEntities(text: string): { name: string; type: string; summary?: string }[] {
	return lines(text).map((line) => {
		const [name, type, ...rest] = line.split(':').map((s) => s.trim());
		return {
			name: name ?? line,
			type: type || 'concept',
			summary: rest.join(':') || undefined
		};
	});
}

/** Slugify a title into a conversation_id (e.g. "Auth migration" → "auth-migration"). */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 200);
}
