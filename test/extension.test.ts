import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPiPermExtension } from "../core/extension.ts";

test("handleToolCall wraps bash command with srt when configured", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-ext-"));
  const root = cwd;
  fs.mkdirSync(path.join(root, "defaults"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "defaults/base.toml"),
    `
version = 1
activeProfile = "workspace"

[profiles.workspace.sandbox.network]
allowedDomains = []
deniedDomains = []
allowUnixSockets = []

[profiles.workspace.sandbox.filesystem]
denyRead = []
allowRead = ["."]
allowWrite = ["."]
denyWrite = []

[profiles.workspace.toolDefaults]
mode = "enforce"
defaultAction = "allow"

[tools.bash]
mode = "enforce"
defaultAction = "allow"
wrapWithSrt = true
srtBinary = "srt"

[audit]
enabled = false

[runtime]
settingsDir = "runtime"
`
  );
  const extension = createPiPermExtension({ cwd, extensionRoot: root, userPath: path.join(cwd, "missing.json"), commandExists: () => true });
  const event = { toolName: "bash", toolCallId: "abc", input: { command: "echo ok" } };
  const result = await extension.handleToolCall(event, {});
  assert.equal(result, undefined);
  assert.match(event.input.command, /^srt --settings /);
  assert.match(event.input.command, / echo ok$/);
});

test("pi-perm command switches only to configured profiles", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-cmd-"));
  const root = cwd;
  fs.mkdirSync(path.join(root, "defaults"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "defaults/base.toml"),
    `
version = 1
activeProfile = "strict"

[profiles.strict.sandbox.network]
allowedDomains = []
deniedDomains = []
allowUnixSockets = []

[profiles.strict.sandbox.filesystem]
denyRead = []
allowRead = []
allowWrite = []
denyWrite = []

[profiles.workspace.sandbox.network]
allowedDomains = []
deniedDomains = []
allowUnixSockets = []

[profiles.workspace.sandbox.filesystem]
denyRead = []
allowRead = ["."]
allowWrite = ["."]
denyWrite = []

[tools]

[audit]
enabled = false
`
  );
  const extension = createPiPermExtension({ cwd, extensionRoot: root, userPath: path.join(cwd, "missing.json") });
  assert.deepEqual((extension.handlePiPermCommand("use missing", {}) as any).ok, false);
  assert.deepEqual((extension.handlePiPermCommand("use workspace", {}) as any).ok, true);
  assert.equal(extension.state.activeProfile, "workspace");
});
