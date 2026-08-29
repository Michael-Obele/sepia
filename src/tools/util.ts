import { McpError } from "tmcp";
import { tool } from "tmcp/utils";
import { MemoryError } from "../db.ts";

/**
 * Sepia's brain-circuit mark (matches the dashboard favicon), as a data URI.
 * Self-contained: no server round-trip, works in dev and prod, and clients
 * that render tool icons (MCP spec 2026-07-28) can display it.
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
 * Wraps a tool handler so that business errors become MCP tool errors
 * (visible to the model as a message) instead of JSON-RPC failures, while
 * protocol-level McpErrors still propagate.
 */
export function safe<T>(handler: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try {
      return tool.text(JSON.stringify(await handler(args), null, 2));
    } catch (error) {
      if (error instanceof McpError) throw error;
      if (error instanceof MemoryError) {
        return tool.error(`[${error.code}] ${error.message}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      return tool.error(message);
    }
  };
}
