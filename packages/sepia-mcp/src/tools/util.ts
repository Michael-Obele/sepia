import { McpError } from "tmcp";
import { tool } from "tmcp/utils";
import { SepiaApiError } from "../client.ts";

/**
 * Sepia's brain-circuit mark (same as the server + dashboard favicon), as a
 * data URI. Self-contained — no server round-trip.
 */
const SEPIA_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><g transform="translate(-0.5455 0.7273) scale(1.272727)" fill="none" stroke="#D4956A" stroke-width="2.28" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18A4 4 0 1 0 19.967 17.483A4 4 0 0 0 20.523 10.895A4 4 0 0 0 17.997 5.125A3 3 0 1 0 12 5Z"/><path d="M11.55 18.4V4.9"/><path d="M13.15 9.9H16.00"/><path d="M13.15 16.9H17.00"/><circle cx="17.45" cy="9.9" r="1.45" fill="#D4956A"/><circle cx="18.45" cy="16.9" r="1.45" fill="#D4956A"/></g></svg>`;

export const SEPIA_ICON: {
  src: string;
  mimeType: string;
  sizes: string[];
} = {
  src: `data:image/svg+xml,${encodeURIComponent(SEPIA_ICON_SVG)}`,
  mimeType: "image/svg+xml",
  sizes: ["any"],
};

/**
 * Wraps a tool handler so business errors (REST API errors, "unauthenticated",
 * missing-arg) become MCP tool errors visible to the model — not JSON-RPC
 * failures — while protocol-level McpErrors still propagate.
 *
 * G2 (silent-arg-drop guardrails): tool schemas are `v.looseObject`, so an
 * unknown key survives tmcp validation instead of being silently stripped
 * (the 2026-09-29 incident: `q` vanished before the handler ever ran). Diff
 * the keys the caller sent against the schema's declared entries and report
 * the extras as `ignored_args` + a hint — the model sees what was dropped
 * instead of inferring it from plausible-looking output. Boundary: unknown
 * keys *inside* nested objects (memory/update/where/…) are still stripped by
 * their `v.object` — top-level only, by design.
 */
export function safe<Schema extends { entries: Record<string, unknown> }, T>(
  schema: Schema,
  handler: (args: T) => Promise<unknown>,
) {
  const declared = new Set(Object.keys(schema.entries));
  return async (args: T) => {
    try {
      const value = await handler(args);
      const sent =
        args && typeof args === "object" ? Object.keys(args as object) : [];
      const ignored = sent.filter((k) => !declared.has(k));
      if (
        ignored.length > 0 &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        return tool.text(
          JSON.stringify(
            {
              ...(value as Record<string, unknown>),
              ignored_args: ignored,
              hint: `Unknown argument(s) ignored: ${ignored.join(", ")}. They are not in this tool's input schema and did NOT apply — match arguments to the schema before retrying.`,
            },
            null,
            2,
          ),
        );
      }
      return tool.text(JSON.stringify(value, null, 2));
    } catch (error) {
      if (error instanceof McpError) throw error;
      if (error instanceof SepiaApiError) {
        return tool.error(`[${error.code}] ${error.message}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      return tool.error(message);
    }
  };
}
