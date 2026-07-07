import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applySecurityBoundary, deepMerge, loadConfig, resolveRuntimeBaseDir, resolveSrtSettingsDir } from "../core/config.ts";

function permissionToml(name = "workspace") {
  return `
activePermissionProfile = "${name}"

[permissions.${name}.filesystem]
":minimal" = "read"

[permissions.${name}.filesystem.":workspace_roots"]
"." = "write"
"**/*.env" = "deny"

[permissions.${name}.network]
enabled = false
`;
}

test("deepMerge overrides nested objects without inventing policy values", () => {
  const merged = deepMerge(
    { tools: { bash: { mode: "enforce", wrapWithSrt: true } } },
    { tools: { bash: { srtBinary: "custom-srt" } } }
  );
  assert.equal(merged.tools.bash.mode, "enforce");
  assert.equal(merged.tools.bash.wrapWithSrt, true);
  assert.equal(merged.tools.bash.srtBinary, "custom-srt");
});

test("project high-risk settings are downgraded unless user config allows them", () => {
  const config = {
    version: 1,
    activePermissionProfile: "workspace",
    tools: {},
    effectivePermissionProfiles: {
      workspace: {
        dangerous: {
          allowAppleEvents: true,
          enableWeakerNestedSandbox: true
        },
        network: { unixSockets: { "/var/run/docker.sock": "allow" }, allowAllUnixSockets: true },
        filesystem: { entries: [] }
      }
    }
  };
  const { config: sanitized, audit } = applySecurityBoundary(config, { user: {} });
  const profile = sanitized.effectivePermissionProfiles.workspace;
  assert.equal(profile.dangerous.allowAppleEvents, false);
  assert.equal(profile.dangerous.enableWeakerNestedSandbox, false);
  assert.equal(profile.network.allowAllUnixSockets, false);
  assert.equal(profile.network.unixSockets["/var/run/docker.sock"], "deny");
  assert.equal(audit.length, 4);
});

test("loadConfig merges default, project, and user config in order", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-"));
  const extensionRoot = dir;
  fs.mkdirSync(path.join(extensionRoot, "defaults"), { recursive: true });
  fs.writeFileSync(
    path.join(extensionRoot, "defaults/base.toml"),
    `
version = 1
${permissionToml("strict")}

[tools.bash]
mode = "enforce"
defaultAction = "confirm"
`
  );
  fs.writeFileSync(path.join(extensionRoot, "config.json"), JSON.stringify({ activePermissionProfile: "strict", tools: { bash: { srtBinary: "srt" } } }));
  const userPath = path.join(dir, "user.json");
  fs.writeFileSync(userPath, JSON.stringify({ tools: { bash: { defaultAction: "allow" } } }));

  const loaded = loadConfig({ cwd: dir, extensionRoot, userPath });
  assert.equal(loaded.config.tools.bash.mode, "enforce");
  assert.equal(loaded.config.tools.bash.srtBinary, "srt");
  assert.equal(loaded.config.tools.bash.defaultAction, "allow");
});

test("loadConfig prefers TOML project config and expands operation command patterns", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-toml-"));
  const extensionRoot = dir;
  fs.mkdirSync(path.join(extensionRoot, "defaults"), { recursive: true });
  fs.writeFileSync(
    path.join(extensionRoot, "defaults/base.toml"),
    `
version = 1
${permissionToml("strict")}

[tools.bash]
mode = "enforce"
defaultAction = "confirm"

[tools.bash.operations]
preset = "recommended"
`
  );
  fs.writeFileSync(path.join(extensionRoot, "config.json"), JSON.stringify({ tools: { bash: { srtBinary: "json-srt" } } }));
  fs.writeFileSync(
    path.join(extensionRoot, "config.toml"),
    `
activePermissionProfile = "strict"

[tools.bash]
srtBinary = "toml-srt"

[tools.bash.operations]
preset = "recommended"
allow = ["pnpm install"]
block = ["gh auth token"]
`
  );

  const loaded = loadConfig({ cwd: dir, extensionRoot, userPath: path.join(dir, "missing.toml") });
  assert.equal(loaded.config.tools.bash.srtBinary, "toml-srt");
  assert.equal(loaded.config.tools.bash.operations.find((rule) => rule.id === "pattern:pnpm install").action, "allow");
  assert.equal(loaded.config.tools.bash.operations.find((rule) => rule.id === "pattern:gh auth token").action, "block");
});

test("runtime settingsDir must be relative to runtime base dir", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-runtime-config-"));
  const extensionRoot = dir;
  fs.mkdirSync(path.join(extensionRoot, "defaults"), { recursive: true });
  fs.writeFileSync(
    path.join(extensionRoot, "defaults/base.toml"),
    `
version = 1
${permissionToml("strict")}

[tools]

[runtime]
settingsDir = "${path.join(os.tmpdir(), "pi-perm-absolute-settings").replaceAll("\\", "\\\\")}"
`
  );
  assert.throws(
    () =>
      loadConfig({
        cwd: dir,
        extensionRoot,
        userPath: path.join(dir, "missing-user.toml")
      }),
    /runtime\.settingsDir must be a relative path/
  );
});

test("runtime directory helpers resolve settings under extension data dir", () => {
  const config = { runtime: { baseDir: "~/pi-perm-state", settingsDir: "state/srt" } };
  const baseDir = resolveRuntimeBaseDir(config);
  assert.equal(baseDir, path.join(os.homedir(), "pi-perm-state"));
  assert.equal(resolveSrtSettingsDir(config, baseDir), path.join(os.homedir(), "pi-perm-state", "state/srt"));
});

test("runtime settingsDir cannot escape runtime base dir", () => {
  assert.throws(
    () => resolveSrtSettingsDir({ runtime: { settingsDir: "../outside" } }, path.join(os.tmpdir(), "pi-perm-base")),
    /runtime\.settingsDir must stay under runtime\.baseDir/
  );
});

// ===== tools.bash.readOnlyCommands config tests =====

test("loadConfig preserves tools.bash.readOnlyCommands as an array", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-readonly-"));
  const extensionRoot = dir;
  fs.mkdirSync(path.join(extensionRoot, "defaults"), { recursive: true });
  fs.writeFileSync(
    path.join(extensionRoot, "defaults/base.toml"),
    `
version = 1
${permissionToml("workspace")}

[tools.bash]
mode = "enforce"
defaultAction = "confirm"
readOnlyCommands = ["bat", "fd", "ag"]
`
  );
  const loaded = loadConfig({ cwd: dir, extensionRoot, userPath: path.join(dir, "missing.toml") });
  assert.deepEqual(loaded.config.tools.bash.readOnlyCommands, ["bat", "fd", "ag"]);
});

test("loadConfig falls back to [] when tools.bash.readOnlyCommands is missing or invalid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-readonly-missing-"));
  const extensionRoot = dir;
  fs.mkdirSync(path.join(extensionRoot, "defaults"), { recursive: true });
  fs.writeFileSync(
    path.join(extensionRoot, "defaults/base.toml"),
    `
version = 1
${permissionToml("workspace")}

[tools.bash]
mode = "enforce"
defaultAction = "confirm"
`
  );
  const loaded = loadConfig({ cwd: dir, extensionRoot, userPath: path.join(dir, "missing.toml") });
  assert.deepEqual(loaded.config.tools.bash.readOnlyCommands, []);
});

// ===== audit file relocation tests =====

import { resolveAuditFile } from "../core/config.ts";

test("resolveAuditFile defaults to runtimeBaseDir/audit.jsonl", () => {
  const resolved = resolveAuditFile({}, "/tmp/pi-perm-base");
  assert.equal(resolved, path.join("/tmp/pi-perm-base", "audit.jsonl"));
});

test("resolveAuditFile appends audit.file as a relative path under runtimeBaseDir", () => {
  const resolved = resolveAuditFile({ audit: { file: "logs/perm.jsonl" } }, "/tmp/pi-perm-base");
  assert.equal(resolved, path.join("/tmp/pi-perm-base", "logs", "perm.jsonl"));
});

test("resolveAuditFile rejects absolute audit.file paths", () => {
  assert.throws(
    () => resolveAuditFile({ audit: { file: "/var/log/audit.jsonl" } }, "/tmp/pi-perm-base"),
    /audit\.file must be a relative path/
  );
});

test("resolveAuditFile rejects audit.file paths that escape runtimeBaseDir", () => {
  assert.throws(
    () => resolveAuditFile({ audit: { file: "../escape.jsonl" } }, "/tmp/pi-perm-base"),
    /audit\.file must stay under runtime\.baseDir/
  );
});

test("resolveAuditFile rejects empty or non-string audit.file", () => {
  assert.throws(() => resolveAuditFile({ audit: { file: "" } }, "/tmp/pi-perm-base"), /audit\.file/);
  assert.throws(() => resolveAuditFile({ audit: { file: 123 } }, "/tmp/pi-perm-base"), /audit\.file/);
});
