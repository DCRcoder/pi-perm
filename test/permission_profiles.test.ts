import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../core/config.ts";
import { evaluateFileAccess, evaluateToolCall } from "../core/policy.ts";
import { toSrtSettings } from "../core/srt.ts";

function makeConfigRoot(defaultToml: string, projectToml = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-permissions-"));
  fs.mkdirSync(path.join(dir, "defaults"), { recursive: true });
  fs.writeFileSync(path.join(dir, "defaults/base.toml"), defaultToml);
  if (projectToml) fs.writeFileSync(path.join(dir, "config.toml"), projectToml);
  return dir;
}

const legacyBaseToml = `
version = 1
activeProfile = "workspace"

[profiles.workspace.sandbox.network]
allowedDomains = []
deniedDomains = []
allowUnixSockets = []

[profiles.workspace.sandbox.filesystem]
denyRead = ["**/*.env"]
allowRead = ["."]
allowWrite = ["."]
denyWrite = [".git/hooks/**"]

[tools.bash]
mode = "enforce"
defaultAction = "allow"
`;

const newBaseToml = `
version = 1
activePermissionProfile = "workspace"

[permissions.workspace.filesystem]
":minimal" = "read"

[permissions.workspace.filesystem.":workspace_roots"]
"." = "write"

[permissions.workspace.network]
enabled = false

[tools.bash]
mode = "enforce"
defaultAction = "allow"
`;

test("SPEC Named permission profiles: loadConfig exposes active permission profile and normalized filesystem entries", () => {
  const dir = makeConfigRoot(
    newBaseToml,
    `
activePermissionProfile = "workspace"

[permissions.workspace.filesystem]
":minimal" = "read"

[permissions.workspace.filesystem.":workspace_roots"]
"." = "write"
".git" = "read"
"**/*.env" = "deny"

[permissions.workspace.network]
enabled = false
`
  );

  const loaded = loadConfig({ cwd: dir, extensionRoot: dir, userPath: path.join(dir, "missing.toml") });
  assert.equal(loaded.config.activePermissionProfile, "workspace");
  assert.equal(loaded.config.effectivePermissionProfile.name, "workspace");
  assert.deepEqual(
    loaded.config.effectivePermissionProfile.filesystem.entries.map((entry: any) => [entry.scope, entry.path, entry.access]),
    [
      [":minimal", ".", "read"],
      [":workspace_roots", ".", "write"],
      [":workspace_roots", ".git", "read"],
      [":workspace_roots", "**/*.env", "deny"]
    ]
  );
});

test("SPEC Complete configuration example: recommended permissions config loads with tools, audit, and runtime", () => {
  const dir = makeConfigRoot(`
version = 1
activePermissionProfile = "workspace"

[profiles.workspace]
description = "Read and edit the workspace, keep network disabled by default."

[permissions.workspace.filesystem]
":minimal" = "read"

[permissions.workspace.filesystem.":workspace_roots"]
"." = "write"
".git" = "read"
".codex" = "read"
".agents" = "read"
"**/*.env" = "deny"
".env" = "deny"
".env.*" = "deny"
".git/hooks/**" = "deny"

[permissions.workspace.filesystem.":tmpdir"]
"." = "write"

[permissions.workspace.filesystem.":slash_tmp"]
"." = "write"

[permissions.workspace.network]
enabled = false
allowLocalBinding = false

[permissions.workspace-network.filesystem]
":minimal" = "read"

[permissions.workspace-network.filesystem.":workspace_roots"]
"." = "write"
"**/*.env" = "deny"
".git" = "read"
".codex" = "read"
".agents" = "read"

[permissions.workspace-network.network]
enabled = true
allowLocalBinding = false

[permissions.workspace-network.network.domains]
"registry.npmjs.org" = "allow"
"api.github.com" = "allow"
"**.example.internal" = "deny"

[permissions.workspace-network.network.unixSockets]
"/var/run/docker.sock" = "deny"

[permissions.workspace.dangerous]
allowAppleEvents = false
enableWeakerNestedSandbox = false
enableWeakerNetworkIsolation = false
allowAllUnixSockets = false

[tools.bash]
mode = "enforce"
defaultAction = "allow"
wrapWithSrt = true
srtBinary = "srt"

[tools.bash.operations]
preset = "recommended"
block = ["~/.ssh/", "gh auth token", ".git/hooks"]
confirm = ["git push", "git commit", "git reset --hard", "git clean", "rm -r", "sudo", "curl | sh", "wget | bash", "scp", "rsync", "npm publish", "pnpm publish", "docker", "kubectl", "terraform", "aws", "gcloud", "az", "open", "osascript"]

[tools.read]
mode = "enforce"
defaultAction = "confirm"
pathFields = ["path"]

[tools.write]
mode = "enforce"
defaultAction = "confirm"
pathFields = ["path", "file_path"]

[tools.edit]
mode = "enforce"
defaultAction = "confirm"
pathFields = ["path", "file_path"]

[prompts]
noUiAction = "block"
confirmTitle = "Sandbox permission"
confirmMessage = "Allow {toolName} for {target}?"

[audit]
enabled = true
file = "audit.jsonl"

[runtime]
baseDir = "~/.pi/agent/extensions/pi-perm"
settingsDir = "runtime"
sessionAllowTtlMs = 1800000
`);

  const loaded = loadConfig({ cwd: dir, extensionRoot: dir, userPath: path.join(dir, "missing.toml") });
  assert.equal(loaded.config.activePermissionProfile, "workspace");
  assert.equal(loaded.config.effectivePermissionProfile.network.enabled, false);
  assert.equal(loaded.config.tools.bash.defaultAction, "allow");
  assert.equal(loaded.config.tools.bash.operations.find((rule: any) => rule.id === "pattern:git push").action, "confirm");
  assert.equal(loaded.config.audit.file, "audit.jsonl");
  assert.equal(loaded.config.runtime.settingsDir, "runtime");
});

test("SPEC Named permission profiles: invalid filesystem access values are rejected", () => {
  const dir = makeConfigRoot(
    legacyBaseToml,
    `
activePermissionProfile = "workspace"

[permissions.workspace.filesystem.":workspace_roots"]
"." = "admin"
`
  );

  assert.throws(
    () => loadConfig({ cwd: dir, extensionRoot: dir, userPath: path.join(dir, "missing.toml") }),
    /read|write|deny|access/
  );
});

test("SPEC Named permission profiles: workspace scoped paths cannot escape the workspace root", () => {
  const dir = makeConfigRoot(
    legacyBaseToml,
    `
activePermissionProfile = "workspace"

[permissions.workspace.filesystem.":workspace_roots"]
"../outside" = "write"
`
  );

  assert.throws(
    () => loadConfig({ cwd: dir, extensionRoot: dir, userPath: path.join(dir, "missing.toml") }),
    /workspace|escape|outside/
  );
});

test("SPEC Named permission profiles: legacy sandbox filesystem is rejected when permissions are absent", () => {
  const dir = makeConfigRoot(legacyBaseToml);
  assert.throws(
    () => loadConfig({ cwd: dir, extensionRoot: dir, userPath: path.join(dir, "missing.toml") }),
    /permissions|sandbox|migrate|迁移/
  );
});

test("SPEC Boundary-first bash approval: workspace-local command is allowed without an operations allowlist", () => {
  const cfg = {
    tools: { bash: { mode: "enforce", defaultAction: "allow", operations: [] } },
    effectivePermissionProfile: {
      name: "workspace",
      filesystem: { entries: [{ scope: ":workspace_roots", path: ".", access: "write" }] },
      network: { enabled: false }
    }
  };
  const decision = evaluateToolCall({ config: cfg, profile: {}, toolName: "bash", input: { command: "pnpm test" }, cwd: process.cwd() });
  assert.equal(decision.action, "allow");
});

test("SPEC Boundary-first bash approval: blocked operations override default allow", () => {
  const cfg = {
    tools: {
      bash: {
        mode: "enforce",
        defaultAction: "allow",
        operations: [{ id: "block-secret-token", commandIncludes: ["gh auth token"], action: "block" }]
      }
    },
    effectivePermissionProfile: { name: "workspace", filesystem: { entries: [] }, network: { enabled: false } }
  };
  const decision = evaluateToolCall({ config: cfg, profile: {}, toolName: "bash", input: { command: "gh auth token" } });
  assert.equal(decision.action, "block");
  assert.equal(decision.rule.id, "block-secret-token");
});

test("SPEC Boundary-first bash approval: network command confirms when network is disabled", () => {
  const cfg = {
    tools: { bash: { mode: "enforce", defaultAction: "allow", operations: [] } },
    effectivePermissionProfile: {
      name: "workspace",
      filesystem: { entries: [{ scope: ":workspace_roots", path: ".", access: "write" }] },
      network: { enabled: false }
    }
  };
  const decision = evaluateToolCall({ config: cfg, profile: {}, toolName: "bash", input: { command: "curl https://example.com/data.json" } });
  assert.equal(decision.action, "confirm");
});

test("SPEC File permission precedence: deny beats broader write for write tool", () => {
  const profile = {
    effectivePermissionProfile: {
      name: "workspace",
      filesystem: {
        entries: [
          { scope: ":workspace_roots", path: ".", access: "write" },
          { scope: ":workspace_roots", path: "**/*.env", access: "deny" }
        ]
      },
      network: { enabled: false }
    }
  };
  const cfg = { tools: { write: { mode: "enforce", defaultAction: "confirm", pathFields: ["path"] } } };

  const decision = evaluateFileAccess({ config: cfg, profile, toolName: "write", input: { path: ".env" }, cwd: process.cwd() });
  assert.equal(decision.action, "block");
});

test("SPEC File permission precedence: read paths are readable but not writable", () => {
  const profile = {
    effectivePermissionProfile: {
      name: "workspace",
      filesystem: { entries: [{ scope: ":workspace_roots", path: "docs", access: "read" }] },
      network: { enabled: false }
    }
  };
  const cfg = {
    tools: {
      read: { mode: "enforce", defaultAction: "confirm", pathFields: ["path"] },
      write: { mode: "enforce", defaultAction: "confirm", pathFields: ["path"] }
    }
  };

  assert.equal(evaluateFileAccess({ config: cfg, profile, toolName: "read", input: { path: "docs/guide.md" }, cwd: process.cwd() }).action, "allow");
  assert.equal(evaluateFileAccess({ config: cfg, profile, toolName: "write", input: { path: "docs/guide.md" }, cwd: process.cwd() }).action, "confirm");
});

test("SPEC SRT generation: effective permission profile can generate sandbox settings", () => {
  const profile = {
    effectivePermissionProfile: {
      name: "workspace-network",
      filesystem: {
        entries: [
          { scope: ":workspace_roots", path: ".", access: "write" },
          { scope: ":workspace_roots", path: "**/*.env", access: "deny" }
        ]
      },
      network: {
        enabled: true,
        domains: { "api.github.com": "allow", "ads.example.com": "deny" },
        unixSockets: { "/var/run/docker.sock": "deny" },
        allowLocalBinding: false
      }
    }
  };

  const settings = toSrtSettings(profile);
  assert.equal(settings.network.enabled, true);
  assert.deepEqual(settings.network.allowedDomains, ["api.github.com"]);
  assert.deepEqual(settings.network.deniedDomains, ["ads.example.com"]);
  assert.deepEqual(settings.filesystem.allowWrite, ["."]);
  assert.deepEqual(settings.filesystem.denyRead, ["**/*.env"]);
  assert.deepEqual(settings.filesystem.denyWrite, ["**/*.env"]);
});
