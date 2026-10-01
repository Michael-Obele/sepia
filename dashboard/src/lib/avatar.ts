/**
 * Avatar image resolution.
 *
 * One decision point for "what picture do we show for this user?":
 *
 *   1. `users.image` — a real uploaded photo, stored in the public `profile`
 *      bucket (Neon S3). Empty today; the upload flow is a later addition.
 *   2. DiceBear `initial-face` — a bold initial plus a face on a pastel square,
 *      seeded by the user's NAME so the same person always gets the same one.
 *
 * `initial-face` paints its own background per seed, so contrast is the
 * style's problem rather than ours: its black art lands on that pastel at
 * 11.2–17.4:1 (WCAG 1.4.6 AAA wants 7:1) for every seed we sampled. Nothing
 * here has to pick a colour or track the active theme.
 *
 * Components only ever call `avatarUrl()` / `avatarPngBlob()` — they never know
 * which source won. Swapping in S3 later means touching this file only.
 */

/** The minimum a component needs to pick an avatar. */
export interface AvatarSource {
	name?: string | null;
	image?: string | null;
}

/** DiceBear style — see the header note on why this one. */
const STYLE = 'initial-face';
const API = 'https://api.dicebear.com/10.x';
/**
 * Blink speed: `slow` | `medium` | `fast` (5.4s cycle at medium). The
 * keyframes ship inside the SVG and DiceBear gates them behind
 * `prefers-reduced-motion`, so there is nothing to handle on this side.
 */
const ANIMATION = 'fast';

/** Seed = the user's name, falling back so we never generate from "undefined". */
function seedOf(user: AvatarSource | null | undefined): string {
	return user?.name?.trim() || 'guest';
}

/**
 * Deterministic SVG avatar URL for `<img>` tags — animated, so the eyes blink.
 */
export function avatarUrl(user: AvatarSource | null | undefined, size = 128): string {
	if (user?.image) return user.image;
	const seed = encodeURIComponent(seedOf(user));
	return `${API}/${STYLE}/svg?seed=${seed}&size=${size}&animationVariant=${ANIMATION}`;
}

/**
 * Static (un-animated) SVG at export resolution — the source we rasterise.
 * DiceBear's `/png` endpoint silently caps at 256px while SVG scales freely,
 * so we ask for the vector and convert it ourselves.
 */
export function avatarExportUrl(user: AvatarSource | null | undefined, size = 1024): string {
	if (user?.image) return user.image;
	const seed = encodeURIComponent(seedOf(user));
	return `${API}/${STYLE}/svg?seed=${seed}&size=${size}`;
}

/**
 * Rasterise the avatar to a PNG blob, for download and the share sheet.
 *
 * DiceBear answers with `access-control-allow-origin: *`, and we load the
 * fetched SVG through a blob URL — same-origin — so the canvas is never
 * tainted and `toBlob()` is allowed.
 */
export async function avatarPngBlob(
	user: AvatarSource | null | undefined,
	size = 1024
): Promise<Blob> {
	const res = await fetch(avatarExportUrl(user, size));
	if (!res.ok) throw new Error(`Avatar fetch failed (${res.status})`);
	const src = await res.blob();

	// A future S3 upload is already a raster — nothing to convert.
	if (!(res.headers.get('content-type') ?? '').includes('svg')) return src;

	const objectUrl = URL.createObjectURL(src);
	try {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('Avatar image failed to decode'));
			img.src = objectUrl;
		});
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D is unavailable');
		ctx.drawImage(img, 0, 0, size, size);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!blob) throw new Error('PNG encoding failed');
		return blob;
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

/** Initials for the Avatar.Fallback ("Michael Obele" → "MO"). */
export function initials(user: AvatarSource | null | undefined): string {
	const parts = (user?.name ?? '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	const first = parts[0]![0] ?? '';
	const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
	return (first + last).toUpperCase();
}
