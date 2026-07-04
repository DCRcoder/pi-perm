import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPiPermExtension } from "../core/extension.ts";

function createExtensionFixture(configBody: string, options: Record<string, unknown> = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-session-"));
  const root = cwd;
  fs.mkdirSync(path.join(root, "defaults"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "defaults/base.toml"),
    configBody
  );
  return createPiPermExtension({ cwd, extensionRoot: root, userPath: path.join(cwd, "missing.json"), commandExists: () => true, ...options });
}

const confirmBashConfig = `
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
wrapWithSrt = false

[tools.bash.operations]
confirm = ["git push", "npm publish"]

[audit]
enabled = false
`;

const confirmBashWithTtlConfig = `
${confirmBashConfig}

[runtime]
sessionAllowTtlMs = 100
`;

const confirmBashWithoutSessionReuseConfig = `
${confirmBashConfig}

[runtime]
sessionAllowTtlMs = 0
`;

const confirmFileConfig = `
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

[tools.write]
mode = "enforce"
defaultAction = "confirm"
pathFields = ["path"]

[audit]
enabled = false
`;

const profileSwitchConfig = `
version = 1
activeProfile = "strict"

[profiles.strict.sandbox.network]
allowedDomains = []
deniedDomains = []
allowUnixSockets = []

[profiles.strict.sandbox.filesystem]
denyRead = []
allowRead = ["."]
allowWrite = ["."]
denyWrite = []

[profiles.strict.toolDefaults]
mode = "enforce"
defaultAction = "allow"

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
wrapWithSrt = false

[tools.bash.operations]
confirm = ["git push"]

[audit]
enabled = false
`;

test("handleToolCall wraps bash command with srt when configured", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-ext-"));
  const runtimeBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-runtime-base-"));
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
  const extension = createPiPermExtension({ cwd, extensionRoot: root, userPath: path.join(cwd, "missing.json"), runtimeBaseDir, commandExists: () => true });
  const event = { toolName: "bash", toolCallId: "abc", input: { command: "echo ok" } };
  const result = await extension.handleToolCall(event, {});
  assert.equal(result, undefined);
  assert.match(event.input.command, /^srt --settings /);
  assert.match(event.input.command, / echo ok$/);
  assert.equal(fs.existsSync(path.join(runtimeBaseDir, "runtime", "abc.srt-settings.json")), true);
  assert.equal(fs.existsSync(path.join(cwd, "runtime")), false);
});

test("relative runtime settingsDir is resolved under runtime base dir", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-ext-"));
  const runtimeBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-runtime-base-"));
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
settingsDir = "state/srt"
`
  );
  const extension = createPiPermExtension({ cwd, extensionRoot: root, userPath: path.join(cwd, "missing.json"), runtimeBaseDir, commandExists: () => true });
  const event = { toolName: "bash", toolCallId: "nested", input: { command: "echo ok" } };
  assert.equal(await extension.handleToolCall(event, {}), undefined);
  assert.equal(fs.existsSync(path.join(runtimeBaseDir, "state/srt", "nested.srt-settings.json")), true);
  assert.equal(fs.existsSync(path.join(cwd, "state")), false);
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

test("confirm allow once asks again for the same target", async () => {
  const extension = createExtensionFixture(confirmBashConfig);
  let prompts = 0;
  const ctx = {
    ui: {
      select: async (_title: string, options: string[]) => {
        prompts += 1;
        assert.deepEqual(options, ["Deny", "Allow once", "Always allow this session"]);
        return "Allow once";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(prompts, 2);
});

test("confirm allow session skips repeated prompts for the same target", async () => {
  const extension = createExtensionFixture(confirmBashConfig);
  let prompts = 0;
  const ctx = {
    ui: {
      select: async () => {
        prompts += 1;
        return "Always allow this session";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(prompts, 1);
});

test("confirm allow session expires after idle ttl", async () => {
  let now = 1000;
  const extension = createExtensionFixture(confirmBashWithTtlConfig, { now: () => now });
  let prompts = 0;
  const ctx = {
    ui: {
      select: async () => {
        prompts += 1;
        return "Always allow this session";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  now += 50;
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  now += 101;
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(prompts, 2);
});

test("non-positive session ttl disables allow session reuse", async () => {
  const extension = createExtensionFixture(confirmBashWithoutSessionReuseConfig);
  let prompts = 0;
  const ctx = {
    ui: {
      select: async () => {
        prompts += 1;
        return "Always allow this session";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(prompts, 2);
});

test("confirm allow session does not apply to different targets", async () => {
  const extension = createExtensionFixture(confirmBashConfig);
  let prompts = 0;
  const ctx = {
    ui: {
      select: async () => {
        prompts += 1;
        return "Always allow this session";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "npm publish" } }, ctx), undefined);
  assert.equal(prompts, 2);
});

test("legacy boolean confirm remains allow once and does not create session cache", async () => {
  const extension = createExtensionFixture(confirmBashConfig);
  let prompts = 0;
  const ctx = {
    ui: {
      confirm: async () => {
        prompts += 1;
        return true;
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(prompts, 2);
});

test("confirm allow session for file tools is scoped by path target", async () => {
  const extension = createExtensionFixture(confirmFileConfig);
  let prompts = 0;
  const ctx = {
    ui: {
      select: async () => {
        prompts += 1;
        return "Always allow this session";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "write", input: { path: "a.txt" } }, ctx), undefined);
  assert.equal(await extension.handleToolCall({ toolName: "write", input: { path: "a.txt" } }, ctx), undefined);
  assert.equal(await extension.handleToolCall({ toolName: "write", input: { path: "b.txt" } }, ctx), undefined);
  assert.equal(prompts, 2);
});

test("profile switch clears session allow cache", async () => {
  const extension = createExtensionFixture(profileSwitchConfig);
  let prompts = 0;
  const ctx = {
    ui: {
      select: async () => {
        prompts += 1;
        return "Always allow this session";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal((extension.handlePiPermCommand("use workspace", {} as any) as any).ok, true);
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(prompts, 2);
});

test("confirm prompt sets blocked-style UI status and restores it after selection", async () => {
  const calls: Array<[string, unknown, unknown?]> = [];
  const extension = createExtensionFixture(confirmBashConfig, {
    events: {
      emit: (channel: string, data: unknown) => calls.push(["emit", channel, data])
    }
  });
  const ctx = {
    ui: {
      setStatus: (key: string, text: string | undefined) => calls.push(["setStatus", key, text]),
      setWorkingMessage: (message?: string) => calls.push(["setWorkingMessage", message]),
      setWorkingIndicator: (options?: unknown) => calls.push(["setWorkingIndicator", options]),
      select: async () => {
        calls.push(["select", undefined]);
        return "Allow once";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.deepEqual(calls.slice(0, 4), [
    ["emit", "herdr:blocked", { active: true, label: "pi-perm permission (bash: git push origin main)" }],
    ["setStatus", "pi-perm", "blocked: waiting for permission"],
    ["setWorkingMessage", "Blocked: waiting for pi-perm permission (bash: git push origin main)"],
    ["setWorkingIndicator", { frames: ["■"] }]
  ]);
  assert.deepEqual(calls.slice(-4), [
    ["emit", "herdr:blocked", { active: false, label: "pi-perm permission (bash: git push origin main)" }],
    ["setStatus", "pi-perm", undefined],
    ["setWorkingMessage", undefined],
    ["setWorkingIndicator", undefined]
  ]);
});

test("confirm prompt restores blocked-style UI status when selection throws", async () => {
  const calls: Array<[string, unknown, unknown?]> = [];
  const extension = createExtensionFixture(confirmBashConfig, {
    events: {
      emit: (channel: string, data: unknown) => calls.push(["emit", channel, data])
    }
  });
  const ctx = {
    ui: {
      setStatus: (key: string, text: string | undefined) => calls.push(["setStatus", key, text]),
      setWorkingMessage: (message?: string) => calls.push(["setWorkingMessage", message]),
      setWorkingIndicator: (options?: unknown) => calls.push(["setWorkingIndicator", options]),
      select: async () => {
        throw new Error("selector failed");
      }
    }
  };

  await assert.rejects(
    () => extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx),
    /selector failed/
  );
  assert.deepEqual(calls.slice(-4), [
    ["emit", "herdr:blocked", { active: false, label: "pi-perm permission (bash: git push origin main)" }],
    ["setStatus", "pi-perm", undefined],
    ["setWorkingMessage", undefined],
    ["setWorkingIndicator", undefined]
  ]);
});

test("session allow cache hit does not set blocked-style UI status", async () => {
  let prompts = 0;
  const calls: Array<[string, unknown, unknown?]> = [];
  const extension = createExtensionFixture(confirmBashConfig, {
    events: {
      emit: (channel: string, data: unknown) => calls.push(["emit", channel, data])
    }
  });
  const ctx = {
    ui: {
      setStatus: (key: string, text: string | undefined) => calls.push(["setStatus", key, text]),
      setWorkingMessage: (message?: string) => calls.push(["setWorkingMessage", message]),
      setWorkingIndicator: (options?: unknown) => calls.push(["setWorkingIndicator", options]),
      select: async () => {
        prompts += 1;
        return "Always allow this session";
      }
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  calls.length = 0;
  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.equal(prompts, 1);
  assert.deepEqual(calls, []);
});

test("confirm prompt does not emit a Herdr done state", async () => {
  const calls: Array<[string, unknown]> = [];
  const extension = createExtensionFixture(confirmBashConfig, {
    events: {
      emit: (channel: string, data: unknown) => calls.push([channel, data])
    }
  });
  const ctx = {
    ui: {
      select: async () => "Allow once"
    }
  };

  assert.equal(await extension.handleToolCall({ toolName: "bash", input: { command: "git push origin main" } }, ctx), undefined);
  assert.deepEqual(calls.map(([channel]) => channel), ["herdr:blocked", "herdr:blocked"]);
  assert.equal(calls.some(([channel, data]) => channel.includes("done") || (data as any)?.state === "done"), false);
});
