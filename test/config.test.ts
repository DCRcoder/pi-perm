import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applySecurityBoundary, deepMerge, loadConfig, resolveRuntimeBaseDir, resolveSrtSettingsDir } from "../core/config.ts";

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
    activeProfile: "workspace",
    tools: {},
    profiles: {
      workspace: {
        sandbox: {
          allowAppleEvents: true,
          enableWeakerNestedSandbox: true,
          network: { allowedDomains: [], deniedDomains: [], allowUnixSockets: ["/var/run/docker.sock"], allowAllUnixSockets: true },
          filesystem: { denyRead: [], allowRead: [], allowWrite: [], denyWrite: [] }
        }
      }
    }
  };
  const { config: sanitized, audit } = applySecurityBoundary(config, { user: {} });
  const sandbox = sanitized.profiles.workspace.sandbox;
  assert.equal(sandbox.allowAppleEvents, false);
  assert.equal(sandbox.enableWeakerNestedSandbox, false);
  assert.equal(sandbox.network.allowAllUnixSockets, false);
  assert.deepEqual(sandbox.network.allowUnixSockets, []);
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
activeProfile = "strict"

[profiles.strict.sandbox.network]
allowedDomains = []
deniedDomains = []

[profiles.strict.sandbox.filesystem]
denyRead = []
allowRead = []
allowWrite = []
denyWrite = []

[tools.bash]
mode = "enforce"
defaultAction = "confirm"
`
  );
  fs.writeFileSync(path.join(extensionRoot, "config.json"), JSON.stringify({ activeProfile: "strict", tools: { bash: { srtBinary: "srt" } } }));
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
activeProfile = "strict"

[profiles.strict.sandbox.network]
allowedDomains = []
deniedDomains = []

[profiles.strict.sandbox.filesystem]
denyRead = []
allowRead = []
allowWrite = []
denyWrite = []

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
activeProfile = "strict"

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
