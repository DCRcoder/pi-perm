import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPiPermExtension } from "./core/extension.ts";

const extensionRoot = path.dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  const extension = createPiPermExtension({ extensionRoot, events: pi.events });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify(`pi-perm loaded: ${extension.state.activeProfile}`, "info");
  });

  pi.on("tool_call", async (event, ctx) => {
    return extension.handleToolCall(event, ctx);
  });

  pi.registerCommand("pi-perm", {
    description: "Show or switch pi-perm permission profiles",
    handler: async (args, ctx) => {
      extension.handlePiPermCommand(args, ctx);
    }
  });

  pi.registerTool({
    name: "pi_perm_policy",
    label: "Pi Perm Policy",
    description: "Read-only summary of the active pi-perm policy. This tool cannot change permissions.",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: JSON.stringify(extension.policySummary(), null, 2) }],
        details: { readOnly: true }
      };
    }
  });
}
