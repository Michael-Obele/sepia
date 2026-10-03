import type { Db } from "../client.ts";
import { MemoryError } from "../errors.ts";
import { and, eq, sql } from "drizzle-orm";
import { entities, namespaces, relations } from "../schema.ts";

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  importance: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight: number;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  depth_reached: number;
}

/**
 * BFS traversal of the knowledge graph from a start entity, in both
 * directions, up to `depth` hops (max 3). Deduplicates visited entities and
 * edges. Same shape as the /api/graph endpoint.
 */
export async function traverseGraph(
  db: Db,
  ownerId: string,
  startId: string,
  depth = 1,
): Promise<GraphResult> {
  const start = await db
    .select({
      id: entities.id,
      name: entities.name,
      type: entities.type,
      importance: entities.importance,
    })
    .from(entities)
    .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
    .where(and(eq(entities.id, startId), eq(namespaces.ownerId, ownerId)))
    .limit(1);
  if (!start[0]) {
    throw new MemoryError("not_found", `entity '${startId}' not found`);
  }

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const addNode = (row: Record<string, unknown>) => {
    const id = String(row.id);
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        label: String(row.name),
        type: String(row.type),
        importance: Number(row.importance),
      });
    }
  };
  addNode(start[0] as unknown as Record<string, unknown>);

  let frontier = new Set<string>([startId]);
  const visited = new Set<string>([startId]);
  let depthReached = 0;

  const hops = Math.min(Math.max(1, Math.floor(depth)), 3);
  for (let d = 1; d <= hops; d++) {
    if (frontier.size === 0) break;
    const ids = [...frontier];
    // Double self-join; pass ids as a Postgres array literal (a raw JS array
    // renders as ANY(($1)) with one string param and fails).
    const idArray = `{${ids.join(",")}}`;
    const res = await db.execute(sql`
      SELECT r.id, r.source_id, r.target_id, r.relation_type, r.weight,
             s.name AS source_name, s.type AS source_type, s.importance AS source_importance,
             t.name AS target_name, t.type AS target_type, t.importance AS target_importance
      FROM ${relations} r
      JOIN ${namespaces} n ON n.id = r.namespace_id
      JOIN ${entities} s ON s.id = r.source_id
      JOIN ${entities} t ON t.id = r.target_id
      WHERE (r.source_id = ANY(${idArray}) OR r.target_id = ANY(${idArray}))
        AND n.owner_id = ${ownerId}
    `);
    const rows = res.rows as Array<Record<string, unknown>>;
    // Only a hop that FOUND a relation counts as reached. An isolated root runs the
    // loop once, finds nothing, and must report depth 0 — reporting "depth 1"
    // beside zero edges is what made a single lonely node read as a bug.
    if (rows.length > 0) depthReached = d;
    const next = new Set<string>();
    for (const row of rows) {
      const edgeId = String(row.id);
      if (!edges.has(edgeId)) {
        edges.set(edgeId, {
          id: edgeId,
          source: String(row.source_id),
          target: String(row.target_id),
          label: String(row.relation_type),
          weight: Number(row.weight),
        });
      }
      for (const side of [
        {
          id: String(row.source_id),
          name: row.source_name,
          type: row.source_type,
          importance: row.source_importance,
        },
        {
          id: String(row.target_id),
          name: row.target_name,
          type: row.target_type,
          importance: row.target_importance,
        },
      ]) {
        addNode({
          id: side.id,
          name: side.name,
          type: side.type,
          importance: side.importance,
        });
        if (!visited.has(side.id)) {
          visited.add(side.id);
          next.add(side.id);
        }
      }
    }
    frontier = next;
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    depth_reached: depthReached,
  };
}

/**
 * The entire knowledge graph: every entity as a node and every relation as
 * an edge. Same shape as `traverseGraph` (`depth_reached` is 0 — this is not
 * a traversal). Powers the dashboard's Obsidian-style "full graph" view.
 */
export async function fullGraph(db: Db, ownerId: string): Promise<GraphResult> {
  // Two queries, ONE HTTP round trip. The Neon HTTP driver costs ~450-500ms per
  // request, so `Promise.all` paid for two of them; `db.batch` pays for one.
  // This is the same fix `getStats` needed — see the note in stats.ts.
  //
  // Both selects are deliberately narrow:
  //  - entities: the graph renders four fields, so selecting every column
  //    dragged ~145KB of `summary` + `haystack_tsv` out of Postgres for 312
  //    rows and then threw all of it away (measured: 997ms vs 492ms, and the
  //    serialized result is unchanged at 55.7KB).
  //  - relations: `GraphEdge` needs five columns, so the two entity joins and
  //    the four extra name/type/importance columns were pure cost — node
  //    labels already come from the entity query.
  const [entityRows, relationRows] = await db.batch([
    db
      .select({
        id: entities.id,
        name: entities.name,
        type: entities.type,
        importance: entities.importance,
      })
      .from(entities)
      .innerJoin(namespaces, eq(namespaces.id, entities.namespaceId))
      .where(eq(namespaces.ownerId, ownerId)),
    db.execute(sql`
      SELECT r.id, r.source_id, r.target_id, r.relation_type, r.weight
      FROM ${relations} r
      JOIN ${namespaces} n ON n.id = r.namespace_id
      WHERE n.owner_id = ${ownerId}
    `),
  ]);

  const nodes: GraphNode[] = entityRows.map((e) => ({
    id: e.id,
    label: e.name,
    type: e.type,
    importance: e.importance ?? 0.5,
  }));

  const edges: GraphEdge[] = (
    relationRows.rows as Array<Record<string, unknown>>
  ).map((r) => ({
    id: String(r.id),
    source: String(r.source_id),
    target: String(r.target_id),
    label: String(r.relation_type),
    weight: Number(r.weight),
  }));

  return { nodes, edges, depth_reached: 0 };
}

/**
 * The entity the Focus view should centre on by default: the most CONNECTED
 * one, not the most-viewed one.
 *
 * Degree is the right heuristic for a graph root; view count is not. A node you
 * open often can still have no edges, and traversing from it returns a single
 * lonely node with nothing to explain why. Measured on the live `personal`
 * namespace: 180 of 312 entities (58%) have zero relations, and the
 * most-accessed entity (`zenpick/compare-page`, 14 views) is one of them — so
 * the old `top_entities[0]` default showed exactly one node every time Focus
 * was opened cold.
 *
 * Returns null when the owner has no relations at all, so callers can fall back
 * instead of rendering a one-node graph.
 */
export async function mostConnectedEntity(
  db: Db,
  ownerId: string,
): Promise<{ id: string; name: string } | null> {
  const res = await db.execute(sql`
    SELECT e.id, e.name, count(r.id)::int AS degree
    FROM ${entities} e
    JOIN ${namespaces} n ON n.id = e.namespace_id
    LEFT JOIN ${relations} r ON r.source_id = e.id OR r.target_id = e.id
    WHERE n.owner_id = ${ownerId}
    GROUP BY e.id, e.name
    ORDER BY degree DESC, e.access_count DESC, e.name
    LIMIT 1
  `);
  const row = (res.rows as Array<Record<string, unknown>>)[0];
  // degree 0 means there is nothing to traverse — better to return null and let
  // the caller say so than to hand back a root that renders one dot.
  if (!row || Number(row.degree) === 0) return null;
  return { id: String(row.id), name: String(row.name) };
}
