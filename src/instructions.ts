/**
 * The memory usage contract, sent to the model via the MCP `instructions`
 * field in the `initialize` handshake. Supporting clients (Claude Code,
 * Codex, VS Code Copilot Chat, Goose, Claude Desktop) inject it into the
 * model's system prompt — the model reads it before any tool schemas or
 * user messages. The bundled Agent Skill (skills/sepia/SKILL.md) carries
 * the same contract for editors that ignore `instructions`.
 *
 * The constant itself lives in @sepia/shared (single source of truth) so
 * the dashboard's Connect page can show it for web-AI custom instructions.
 */
export { MEMORY_CONTRACT, MEMORY_CONTRACT_QUICK } from "@sepia/shared";
