import test from "node:test";
import assert from "node:assert/strict";
import piPerm from "../index.ts";

test("extension registers a bash tool override when pi exposes bash spawnHook support", () => {
  const registeredTools: any[] = [];
  const handlers = new Map<string, any>();
  const pi: any = {
    events: { emit() {} },
    on(event: string, handler: any) {
      handlers.set(event, handler);
    },
    registerCommand() {},
    registerTool(tool: any) {
      registeredTools.push(tool);
    }
  };

  piPerm(pi);

  assert.equal(registeredTools.some((tool) => tool.name === "bash"), true);
  assert.equal(registeredTools.some((tool) => tool.name === "pi_perm_policy"), true);
  assert.equal(typeof handlers.get("tool_call"), "function");
});
