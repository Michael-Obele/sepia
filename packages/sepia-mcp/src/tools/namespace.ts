import type { McpServer } from "tmcp";
import * as v from "valibot";
import { NamespaceToolInput } from "@sepia/shared/schemas";
import type { SepiaClient } from "../client.ts";
import { safe, SEPIA_ICON } from "./util.ts";

export function registerNamespaceTools(
  server: McpServer<any, any>,
  client: SepiaClient,
) {
  server.tool(
    {
      name: "manage_namespace",
      title: "Manage Namespaces",
      description:
        "Create, list, get, update or delete namespaces — one per project, named by repo slug. Use action=ensure once per session to scope yourself, then pass that name on every read and write.",
      icons: [SEPIA_ICON],
      schema: NamespaceToolInput,
    },
    safe(NamespaceToolInput, async (args: v.InferInput<typeof NamespaceToolInput>) => {
      switch (args.action) {
        case "create": {
          if (!args.name) throw new Error("action=create requires name");
          return {
            action: "create",
            namespace: await client.createNamespace(
              args.name,
              args.description,
            ),
          };
        }
        case "ensure": {
          if (!args.name) throw new Error("action=ensure requires name");
          const res = await client.ensureNamespace(args.name, args.description);
          return { action: "ensure", ...res };
        }
        case "list":
          return {
            action: "list",
            namespaces: (await client.listNamespaces()).namespaces,
          };
        case "get": {
          const idOrName = args.id ?? args.name;
          if (!idOrName) throw new Error("action=get requires id or name");
          return {
            action: "get",
            namespace: await client.getNamespace(idOrName),
          };
        }
        case "update": {
          const idOrName = args.id ?? args.name;
          if (!idOrName) throw new Error("action=update requires id or name");
          if (args.new_name === undefined && !args.description)
            throw new Error("action=update requires new_name or description");
          return {
            action: "update",
            namespace: await client.updateNamespace(idOrName, {
              name: args.new_name,
              description: args.description,
            }),
          };
        }
        case "delete": {
          const idOrName = args.id ?? args.name;
          if (!idOrName) throw new Error("action=delete requires id or name");
          return {
            action: "delete",
            deleted: await client.deleteNamespace(idOrName),
          };
        }
      }
    }),
  );
}
