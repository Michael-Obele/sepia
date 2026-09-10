import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import { eq, sql } from "drizzle-orm";
import { memories, namespaces, oauthClients } from "../schema.ts";
import { isLocalClient } from "./oauth-clients.ts";

/**
 * Plan limits — the pricing page's contract (Free vs Pro).
 * Reads/search/export are NEVER blocked; only writes pause at the limit,
 * with the dashboard nudging at ~80%.
 * Web AI connections = remote OAuth clients (counted). Local (loopback)
 * OAuth clients and bearer-token AI editors are never counted, and are
 * unlimited on every plan.
 */
export type Plan = "free" | "pro";

export interface PlanLimits {
  maxNamespaces: number;
  maxMemories: number;
  /** null = unlimited. */
  maxAiConnections: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxNamespaces: 1, maxMemories: 1_000, maxAiConnections: 2 },
  pro: { maxNamespaces: 100, maxMemories: 1_000_000, maxAiConnections: null },
};

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  return PLAN_LIMITS[plan === "pro" ? "pro" : "free"];
}

export async function countNamespaces(
  db: Db,
  ownerId: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(namespaces)
    .where(eq(namespaces.ownerId, ownerId));
  return rows[0]?.n ?? 0;
}

export async function countMemories(db: Db, ownerId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memories)
    .innerJoin(namespaces, eq(memories.namespaceId, namespaces.id))
    .where(eq(namespaces.ownerId, ownerId));
  return rows[0]?.n ?? 0;
}

/**
 * Web AI connections = OAuth clients bound to the account, EXCLUDING local
 * (loopback) clients. A client that only redirects to the user's own machine
 * is a local editor — LM Studio, Cursor, … — and the plan treats editors as
 * unlimited.
 *
 * Excluding them HERE (not just at the assertion) is what keeps enforcement
 * and the dashboard's usage meter in agreement — both call this function, and
 * a mismatch is what makes a limit error contradict the numbers on screen.
 *
 * Counted in JS rather than SQL because "is this redirect local?" depends on
 * parsing each URI; an account has only a handful of clients, so it stays
 * cheap.
 */
export async function countAiConnections(
  db: Db,
  ownerId: string,
): Promise<number> {
  const rows = await db
    .select({ redirectUris: oauthClients.redirectUris })
    .from(oauthClients)
    .where(eq(oauthClients.ownerId, ownerId));
  return rows.filter((row) => !isLocalClient(row.redirectUris)).length;
}

export async function assertNamespaceQuota(
  db: Db,
  ownerId: string,
  plan: string | null | undefined,
): Promise<void> {
  const limits = getPlanLimits(plan);
  const n = await countNamespaces(db, ownerId);
  if (n >= limits.maxNamespaces) {
    throw new MemoryError(
      "plan_limit",
      `plan limit reached: ${limits.maxNamespaces} namespace${limits.maxNamespaces === 1 ? "" : "s"} on the ${plan ?? "free"} plan. Upgrade to Pro for more.`,
    );
  }
}

export async function assertMemoryQuota(
  db: Db,
  ownerId: string,
  plan: string | null | undefined,
): Promise<void> {
  const limits = getPlanLimits(plan);
  const n = await countMemories(db, ownerId);
  if (n >= limits.maxMemories) {
    throw new MemoryError(
      "plan_limit",
      `plan limit reached: ${limits.maxMemories.toLocaleString()} memories on the ${plan ?? "free"} plan. Upgrade to Pro for more.`,
    );
  }
}

export async function assertAiConnectionQuota(
  db: Db,
  ownerId: string,
  plan: string | null | undefined,
): Promise<void> {
  const limits = getPlanLimits(plan);
  if (limits.maxAiConnections === null) return;
  const n = await countAiConnections(db, ownerId);
  if (n >= limits.maxAiConnections) {
    throw new MemoryError(
      "plan_limit",
      `plan limit reached: ${limits.maxAiConnections} Web AI connection${limits.maxAiConnections === 1 ? "" : "s"} on the ${plan ?? "free"} plan. Upgrade to Pro for unlimited Web AI connections. AI editors don’t count toward this limit.`,
    );
  }
}

export interface Usage {
  namespaces: number;
  memories: number;
  ai_connections: number;
  limits: PlanLimits;
}

/** Usage counts + limits for the dashboard (nudge at ~80%). */
export async function getUsage(
  db: Db,
  ownerId: string,
  plan: string | null | undefined,
): Promise<Usage> {
  const [namespaces, memories, aiConnections] = await Promise.all([
    countNamespaces(db, ownerId),
    countMemories(db, ownerId),
    countAiConnections(db, ownerId),
  ]);
  return {
    namespaces,
    memories,
    ai_connections: aiConnections,
    limits: getPlanLimits(plan),
  };
}
