import { db } from "../packages/shared/src/db/client.ts";
import {
  users,
  namespaces,
  memories,
  entities,
  accounts,
  memoryEntityLinks,
} from "../packages/shared/src/db/schema.ts";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

const DEMO_EMAIL = "demo@sepia.svelte-apps.me";
const DEMO_PASSWORD = "demo1234";
const DEMO_NAME = "Demo User";

async function main() {
  const d = db();
  console.log(`Seeding easy demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

  // 1. Find or create user
  let user = await d
    .select()
    .from(users)
    .where(eq(users.email, DEMO_EMAIL.toLowerCase()))
    .limit(1)
    .then((r) => r[0]);

  if (!user) {
    console.log("Creating new demo user...");
    const id = crypto.randomUUID();
    const now = new Date();
    // Create user directly
    const inserted = await d
      .insert(users)
      .values({
        id,
        name: DEMO_NAME,
        email: DEMO_EMAIL.toLowerCase(),
        emailVerified: true,
        plan: "free",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    user = inserted[0];
    console.log(`Created user: ${user.id} ${user.email}`);

    // Create credential account
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await d.insert(accounts).values({
      id: crypto.randomUUID(),
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      issuer: "local:credential",
      password: passwordHash,
    });
    console.log("Created credential account");
  } else {
    console.log(
      `Found existing user: ${user.id} ${user.email} plan=${user.plan}`,
    );
    // Reset password to easy one
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    // Check if credential account exists
    const cred = await d
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, user.id),
          eq(accounts.providerId, "credential"),
        ),
      )
      .limit(1)
      .then((r) => r[0]);
    if (cred) {
      await d
        .update(accounts)
        .set({ password: passwordHash })
        .where(eq(accounts.id, cred.id));
      console.log("Reset password for existing credential account");
    } else {
      await d.insert(accounts).values({
        id: crypto.randomUUID(),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        issuer: "local:credential",
        password: passwordHash,
      });
      console.log("Created missing credential account");
    }
    // Ensure emailVerified and plan free
    await d
      .update(users)
      .set({ emailVerified: true, plan: "free", updatedAt: new Date() })
      .where(eq(users.id, user.id));
    console.log("Updated user to verified/free");
  }

  const ownerId = user.id;

  // 2. Ensure personal namespace exists
  let ns = await d
    .select()
    .from(namespaces)
    .where(
      and(eq(namespaces.ownerId, ownerId), eq(namespaces.name, "personal")),
    )
    .limit(1)
    .then((r) => r[0]);
  let namespaceId: string;
  if (!ns) {
    const inserted = await d
      .insert(namespaces)
      .values({
        ownerId,
        name: "personal",
        description: "Default namespace",
      })
      .returning();
    ns = inserted[0];
    console.log(`Created personal namespace: ${ns.id}`);
    namespaceId = ns.id;
  } else {
    console.log(`Found personal namespace: ${ns.id}`);
    namespaceId = ns.id;
  }

  // 3. Clean existing data in this namespace (memories, entities, links, relations)
  // Delete links first, then memories/entities
  const existingMems = await d
    .select({ id: memories.id })
    .from(memories)
    .where(eq(memories.namespaceId, namespaceId));
  if (existingMems.length > 0) {
    console.log(`Cleaning ${existingMems.length} existing memories...`);
    // Delete links
    for (const m of existingMems) {
      await d
        .delete(memoryEntityLinks)
        .where(eq(memoryEntityLinks.memoryId, m.id));
    }
    await d.delete(memories).where(eq(memories.namespaceId, namespaceId));
  }
  const existingEnts = await d
    .select({ id: entities.id })
    .from(entities)
    .where(eq(entities.namespaceId, namespaceId));
  if (existingEnts.length > 0) {
    console.log(`Cleaning ${existingEnts.length} existing entities...`);
    // Relations will cascade, but delete explicitly
    await d.execute(
      sql`DELETE FROM relations WHERE namespace_id = ${namespaceId}`,
    );
    await d.delete(entities).where(eq(entities.namespaceId, namespaceId));
  }
  // Also clean relations just in case
  await d.execute(
    sql`DELETE FROM relations WHERE namespace_id = ${namespaceId}`,
  );

  // 4. Seed 1 entity + 2 memories (clean, no personal data)
  console.log("Seeding 1 entity + 2 memories...");

  const entityRows = await d
    .insert(entities)
    .values({
      namespaceId,
      name: "Demo Project",
      type: "project",
      summary: "Demo project for video walkthrough",
      metadata: {},
      importance: 0.8,
      tags: ["demo"],
    })
    .returning();
  const entity = entityRows[0];
  console.log(`Created entity: ${entity.id} ${entity.name}`);

  const mem1 = await d
    .insert(memories)
    .values({
      namespaceId,
      content: "Demo User prefers dark mode and Svelte 5 with runes",
      type: "preference",
      importance: 0.8,
      source: "demo-seed",
      metadata: {},
      tags: ["demo"],
    })
    .returning();
  console.log(`Created memory 1: ${mem1[0].id}`);

  const mem2 = await d
    .insert(memories)
    .values({
      namespaceId,
      content:
        "Sepia is a memory MCP server with 7 tools and conversation migration",
      type: "fact",
      importance: 0.8,
      source: "demo-seed",
      metadata: {},
      tags: ["demo"],
    })
    .returning();
  console.log(`Created memory 2: ${mem2[0].id}`);

  // Link first memory to entity (optional, shows graph)
  await d.insert(memoryEntityLinks).values({
    memoryId: mem1[0].id,
    entityId: entity.id,
  });
  console.log("Linked memory 1 to entity");

  // 5. Also reset the old demo+test account to easy password for backup
  const oldEmail = "demo+test-1788854183@svelte-apps.me";
  const oldUser = await d
    .select()
    .from(users)
    .where(eq(users.email, oldEmail.toLowerCase()))
    .limit(1)
    .then((r) => r[0]);
  if (oldUser) {
    const oldHash = await hashPassword(DEMO_PASSWORD);
    const oldCred = await d
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, oldUser.id),
          eq(accounts.providerId, "credential"),
        ),
      )
      .limit(1)
      .then((r) => r[0]);
    if (oldCred) {
      await d
        .update(accounts)
        .set({ password: oldHash })
        .where(eq(accounts.id, oldCred.id));
      console.log(
        `Reset old demo account ${oldEmail} password to ${DEMO_PASSWORD}`,
      );
    }
  }

  // 6. Verify
  const finalMems = await d.execute(
    sql`SELECT content, type FROM memories WHERE namespace_id = ${namespaceId} ORDER BY created_at`,
  );
  const finalEnts = await d.execute(
    sql`SELECT name, type, summary FROM entities WHERE namespace_id = ${namespaceId} ORDER BY created_at`,
  );
  console.log("\n=== VERIFICATION ===");
  console.log(`User: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`User ID: ${ownerId}`);
  console.log(`Namespace: personal (${namespaceId})`);
  console.log(
    `Memories: ${finalMems.rows.length}`,
    JSON.stringify(finalMems.rows, null, 2),
  );
  console.log(
    `Entities: ${finalEnts.rows.length}`,
    JSON.stringify(finalEnts.rows, null, 2),
  );
  console.log("\n=== CREDENTIALS FOR VIDEO ===");
  console.log(`Email: ${DEMO_EMAIL}`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log(
    `Login URL: https://sepia.svelte-apps.me/login or https://sepia.svelte-apps.me/app`,
  );
  console.log(`Also works (old): ${oldEmail} / ${DEMO_PASSWORD}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
