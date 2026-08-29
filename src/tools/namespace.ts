import type { McpServer } from "tmcp";
import * as v from "valibot";
import { NamespaceToolInput } from "@sepia/shared";
import { db } from "../db.ts";
import {
  createNamespace,
  deleteNamespace,
  getNamespace,
  listNamespaces,
} from "@sepia/shared";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerNamespaceTools(server: McpServer<any, any>) {
  server.tool(
    {
      name: "manage_namespace",
      title: "Manage Namespaces",
      description:
        "Create, list, get, or delete namespaces — isolated memory containers.",
      icons: [SEPIA_ICON],
      schema: NamespaceToolInput,
    },
    safe(async (args: v.InferInput<typeof NamespaceToolInput>) => {
      const user = server.ctx.custom?.user;
      if (!user) throw new Error("unauthenticated");
      const sql = db();
      switch (args.action) {
        case "create": {
          if (!args.name) throw new Error("action=create requires name");
          return {
            action: "create",
            namespace: await createNamespace(
              sql,
              user.id,
              args.name,
              args.description,
              user.plan,
            ),
          };
        }
        case "list":
          return {
            action: "list",
            namespaces: await listNamespaces(sql, user.id),
          };
        case "get": {
          const idOrName = args.id ?? args.name;
          if (!idOrName) throw new Error("action=get requires id or name");
          return {
            action: "get",
            namespace: await getNamespace(sql, user.id, idOrName),
          };
        }
        case "delete": {
          const idOrName = args.id ?? args.name;
          if (!idOrName) throw new Error("action=delete requires id or name");
          return {
            action: "delete",
            deleted: await deleteNamespace(sql, user.id, idOrName),
          };
        }
      }
    }),
  );
}
