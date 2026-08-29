import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import { eq, sql } from "drizzle-orm";
import { memories, namespaces, oauthClients } from "../schema.ts";

/**
 * Plan limits — the pricing page's contract (Free vs Pro).
 * Reads/search/export are NEVER blocked; only writes pause at the limit,
 * with the dashboard nudging at ~80%.
 */
export type Plan = "free" | "pro";

export interface PlanLimits {
  maxNamespaces: number;
  maxMemories: number;
  /** null = unlimited. */
  maxAiConnections: number | null;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxNamespaces: 1, maxMemories: 1_000, maxAiConnections: 1 },
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

/** AI connections = OAuth clients bound to the account. */
export async function countAiConnections(
  db: Db,
  ownerId: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(oauthClients)
    .where(eq(oauthClients.ownerId, ownerId));
  return rows[0]?.n ?? 0;
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
      `plan limit reached: ${limits.maxAiConnections} AI connection${limits.maxAiConnections === 1 ? "" : "s"} on the ${plan ?? "free"} plan. Upgrade to Pro for unlimited connections.`,
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
