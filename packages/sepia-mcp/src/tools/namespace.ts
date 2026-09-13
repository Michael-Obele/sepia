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
        "Create, list, get, or delete namespaces — isolated memory containers.",
      icons: [SEPIA_ICON],
      schema: NamespaceToolInput,
    },
    safe(async (args: v.InferInput<typeof NamespaceToolInput>) => {
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
