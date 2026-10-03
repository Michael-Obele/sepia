import { query } from '$app/server';
import { memoryDigestQuery, namespacesQuery, type NamespaceStats } from '@sepia/shared';
import { db } from '$lib/server/db';
import { requireAuth } from '$lib/server/auth';

/** How many digests the page loads. */
const DIGEST_LIMIT = 50;

/**
 * Everything `/app/conversations` needs for its first paint, in ONE Neon HTTP
 * round trip: the digest rows plus the namespace filter options.
 *
 * The `metadata.kind === "conversation"` test runs HERE rather than in the
 * component. It is what separates a real digest from a regular memory that
 * merely carries the `conversation` tag, and doing it server-side keeps those
 * rows (full `content`, `metadata`) off the wire entirely.
 */
export const getConversationsPage = query(async () => {
	const user = await requireAuth();
	const sql = db();
	const [rows, namespaces] = await sql.batch([
		memoryDigestQuery(sql, user.id, { tags: ['conversation'], limit: DIGEST_LIMIT }),
		namespacesQuery(sql, user.id)
	]);
	return {
		digests: rows.filter(
			(d) => (d.metadata as Record<string, unknown> | null)?.kind === 'conversation'
		),
		namespaces: namespaces.rows as unknown as NamespaceStats[]
	};
});
