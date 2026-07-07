import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { normalizeOperations } from "./operations.ts";

export const EXTENSION_DIR = ".";
export const EXTENSION_DATA_DIR = "~/.pi/agent/extensions/pi-perm";
export const USER_CONFIG_ENV = "PI_PERM_USER_CONFIG";
type AnyRecord = Record<string, any>;

export function expandHome(value: any, homeDir = os.homedir()) {
  if (typeof value !== "string") return value;
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return value;
}

export function readConfigFile(filePath: any) {
  if (!filePath || !fs.existsSync(filePath)) return undefined;
  const text = fs.readFileSync(filePath, "utf8");
  try {
    if (filePath.endsWith(".toml")) return parseToml(text);
    return JSON.parse(text);
  } catch (error: any) {
    error.message = `${filePath}: ${error.message}`;
    throw error;
  }
}

export const readJsonFile = readConfigFile;

export function deepMerge(base: any, override: any): any {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = deepMerge(out[key], value);
  }
  return out;
}

function isPlainObject(value: any) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateConfig(config: any) {
  const errors = [];
  if (!config || typeof config !== "object") errors.push("config must be an object");
  if (config?.version !== 1) errors.push("version must be 1");
  if (!config?.activePermissionProfile || typeof config.activePermissionProfile !== "string") errors.push("activePermissionProfile must be a string");
  if (!config?.permissions || typeof config.permissions !== "object") errors.push("permissions must be an object");
  if (!config?.tools || typeof config.tools !== "object") errors.push("tools must be an object");
  if (config?.activePermissionProfile && config?.permissions && !config.permissions[config.activePermissionProfile]) {
    errors.push(`activePermissionProfile '${config.activePermissionProfile}' is not defined`);
  }
  if (path.isAbsolute(config?.runtime?.settingsDir ?? "")) {
    errors.push("runtime.settingsDir must be a relative path under runtime.baseDir");
  }
  for (const [name, profile] of Object.entries(config?.profiles ?? {}) as Array<[string, AnyRecord]>) {
    if (profile?.sandbox?.filesystem || profile?.sandbox?.network) {
      errors.push(`profiles.${name}.sandbox is no longer supported; migrate permissions to permissions.${name}`);
    }
  }
  for (const [name, permission] of Object.entries(config?.permissions ?? {}) as Array<[string, AnyRecord]>) {
    if (!permission?.filesystem || typeof permission.filesystem !== "object") {
      errors.push(`permissions.${name}.filesystem is required`);
    }
    validateFilesystemPermissions(name, permission?.filesystem, errors);
    const network = permission?.network ?? {};
    if (typeof network.enabled !== "boolean") errors.push(`permissions.${name}.network.enabled must be a boolean`);
    for (const [host, action] of Object.entries(network.domains ?? {})) {
      if (!["allow", "deny"].includes(action as string)) errors.push(`permissions.${name}.network.domains.${host} must be allow or deny`);
    }
    for (const [socket, action] of Object.entries(network.unixSockets ?? {})) {
      if (!["allow", "deny"].includes(action as string)) errors.push(`permissions.${name}.network.unixSockets.${socket} must be allow or deny`);
    }
  }
  if (errors.length) {
    const error: any = new Error(`Invalid pi-perm config:\n- ${errors.join("\n- ")}`);
    error.errors = errors;
    throw error;
  }
  return config;
}

function validateFilesystemPermissions(profileName: string, filesystem: AnyRecord = {}, errors: string[]) {
  for (const [key, value] of Object.entries(filesystem)) {
    if (key === "glob_scan_max_depth") continue;
    if (typeof value === "string") {
      validateAccessValue(`permissions.${profileName}.filesystem.${key}`, value, errors);
      continue;
    }
    if (isPlainObject(value)) {
      for (const [subpath, access] of Object.entries(value)) {
        validateAccessValue(`permissions.${profileName}.filesystem.${key}.${subpath}`, access, errors);
        if (key === ":workspace_roots" && escapesWorkspaceRoot(subpath)) {
          errors.push(`permissions.${profileName}.filesystem.${key}.${subpath} must stay inside workspace roots`);
        }
      }
      continue;
    }
    errors.push(`permissions.${profileName}.filesystem.${key} must be an access string or subpath table`);
  }
}

function validateAccessValue(field: string, value: any, errors: string[]) {
  if (!["read", "write", "deny"].includes(value)) errors.push(`${field} must be read, write, or deny`);
}

function escapesWorkspaceRoot(subpath: string) {
  return path.isAbsolute(subpath) || subpath === ".." || subpath.startsWith("../") || subpath.includes("/../");
}

export function loadConfig(options: AnyRecord = {}) {
  const cwd = options.cwd ?? process.cwd();
  const extensionRoot = options.extensionRoot ?? path.join(cwd, EXTENSION_DIR);
  const defaultPath = options.defaultPath ?? path.join(extensionRoot, "defaults/base.toml");
  const projectPath = options.projectPath ?? firstExistingPath([path.join(extensionRoot, "config.toml"), path.join(extensionRoot, "config.json")]);
  const userPath =
    options.userPath ??
    process.env[USER_CONFIG_ENV] ??
    firstExistingPath([
      path.join(os.homedir(), ".pi/agent/extensions/pi-perm/config.toml"),
      path.join(os.homedir(), ".pi/agent/extensions/pi-perm/config.json")
    ]);

  const defaults = readConfigFile(defaultPath) ?? {};
  const project = readConfigFile(projectPath) ?? {};
  const user = readConfigFile(expandHome(userPath)) ?? {};
  const merged = validateConfig(normalizeConfig(deepMerge(deepMerge(defaults, project), user)));
  return applySecurityBoundary(merged, { project, user });
}

function firstExistingPath(paths: string[]) {
  return paths.find((candidate) => fs.existsSync(expandHome(candidate))) ?? paths[0];
}

export function normalizeConfig(config: any) {
  normalizePermissionProfiles(config);
  for (const policy of Object.values(config.tools ?? {}) as AnyRecord[]) {
    if (policy.operations !== undefined) {
      policy.operations = normalizeOperations(policy.operations);
    }
    if (policy.readOnlyCommands !== undefined) {
      // 只接受字符串数组；其他类型统一回退为 []，保证运行时接口稳定。
      if (!Array.isArray(policy.readOnlyCommands)) {
        policy.readOnlyCommands = [];
      } else {
        policy.readOnlyCommands = policy.readOnlyCommands.filter((item: any) => typeof item === "string");
      }
    } else {
      // 默认为空数组，使 getEffectiveReadOnlyCommands 可以无脑拼接内置白名单。
      policy.readOnlyCommands = [];
    }
  }
  return config;
}

export function normalizePermissionProfiles(config: any) {
  if (config.activePermissionProfile === undefined && typeof config.activeProfile === "string") {
    config.activePermissionProfile = config.activeProfile;
  }
  config.activePermissionProfile = config.activePermissionProfile ?? "workspace";
  config.profiles = config.profiles ?? {};
  config.permissions = { ...getBuiltinPermissions(), ...(config.permissions ?? {}) };
  config.effectivePermissionProfiles = Object.fromEntries(
    (Object.entries(config.permissions) as Array<[string, AnyRecord]>).map(([name, permission]) => [name, toEffectivePermissionProfile(name, permission)])
  );
  config.effectivePermissionProfile = config.effectivePermissionProfiles[config.activePermissionProfile];
  if (!config.profiles[config.activePermissionProfile]) {
    config.profiles[config.activePermissionProfile] = { description: `${config.activePermissionProfile} permission profile` };
  }
  return config;
}

function getBuiltinPermissions() {
  return {
    ":read-only": {
      filesystem: {
        ":minimal": "read",
        ":workspace_roots": { ".": "read", "**/*.env": "deny", ".env": "deny", ".env.*": "deny" }
      },
      network: { enabled: false, allowLocalBinding: false }
    },
    ":workspace": {
      filesystem: {
        ":minimal": "read",
        ":workspace_roots": { ".": "write", ".git": "read", ".codex": "read", ".agents": "read", "**/*.env": "deny", ".env": "deny", ".env.*": "deny", ".git/hooks/**": "deny" },
        ":tmpdir": { ".": "write" },
        ":slash_tmp": { ".": "write" }
      },
      network: { enabled: false, allowLocalBinding: false }
    },
    ":workspace-network": {
      filesystem: {
        ":minimal": "read",
        ":workspace_roots": { ".": "write", ".git": "read", ".codex": "read", ".agents": "read", "**/*.env": "deny" },
        ":tmpdir": { ".": "write" },
        ":slash_tmp": { ".": "write" }
      },
      network: { enabled: true, allowLocalBinding: false, domains: {} }
    },
    ":danger-full-access": {
      filesystem: { ":root": "write" },
      network: { enabled: true, allowLocalBinding: true, domains: { "*": "allow" } }
    }
  };
}

function toEffectivePermissionProfile(name: string, permission: AnyRecord) {
  return {
    name,
    filesystem: { entries: normalizeFilesystemEntries(permission.filesystem ?? {}) },
    network: {
      enabled: Boolean(permission.network?.enabled),
      domains: permission.network?.domains ?? {},
      unixSockets: permission.network?.unixSockets ?? {},
      allowLocalBinding: Boolean(permission.network?.allowLocalBinding)
    },
    dangerous: permission.dangerous ?? {}
  };
}

function normalizeFilesystemEntries(filesystem: AnyRecord) {
  const entries = [];
  for (const [scopeOrPath, value] of Object.entries(filesystem)) {
    if (scopeOrPath === "glob_scan_max_depth") continue;
    if (typeof value === "string") {
      entries.push(createPermissionEntry(scopeOrPath, ".", value));
      continue;
    }
    if (isPlainObject(value)) {
      for (const [subpath, access] of Object.entries(value)) {
        entries.push(createPermissionEntry(scopeOrPath, subpath, access));
      }
    }
  }
  return entries;
}

function createPermissionEntry(scopeOrPath: string, subpath: string, access: any) {
  const knownScopes = new Set([":root", ":minimal", ":workspace_roots", ":tmpdir", ":slash_tmp"]);
  const scope = knownScopes.has(scopeOrPath) ? scopeOrPath : "path";
  const entryPath = scope === "path" ? scopeOrPath : subpath;
  return {
    scope,
    path: entryPath,
    access,
    specificity: String(entryPath).split("/").length + (String(entryPath).includes("*") ? 0 : 100),
    source: "permissions"
  };
}

export function applySecurityBoundary(config: any, sources: AnyRecord = {}) {
  const user = sources.user ?? {};
  const audit = [];
  const userPermissions = user.permissions ?? {};
  const highRisk = [
    "allowAppleEvents",
    "enableWeakerNestedSandbox",
    "enableWeakerNetworkIsolation",
    "allowAllUnixSockets"
  ];
  const dockerSocket = "/var/run/docker.sock";

  for (const [profileName, profile] of Object.entries(config.effectivePermissionProfiles ?? {}) as Array<[string, AnyRecord]>) {
    const dangerous = profile.dangerous ?? {};
    const network = profile.network ?? {};
    const userDangerous = userPermissions[profileName]?.dangerous ?? {};
    const userNetwork = userPermissions[profileName]?.network ?? {};

    for (const key of highRisk) {
      if (dangerous[key] === true && userDangerous[key] !== true) {
        dangerous[key] = false;
        audit.push({ type: "downgrade", profile: profileName, key, reason: "requires user config" });
      }
      if (key === "allowAllUnixSockets" && network[key] === true && userNetwork[key] !== true) {
        network[key] = false;
        audit.push({ type: "downgrade", profile: profileName, key: `network.${key}`, reason: "requires user config" });
      }
    }

    const sockets = Object.entries(network.unixSockets ?? {}).filter(([, action]) => action === "allow").map(([socket]) => socket);
    if (sockets.includes(dockerSocket) && userNetwork.unixSockets?.[dockerSocket] !== "allow") {
      network.unixSockets = { ...(network.unixSockets ?? {}), [dockerSocket]: "deny" };
      audit.push({ type: "downgrade", profile: profileName, key: "network.allowUnixSockets", value: dockerSocket, reason: "requires user config" });
    }
  }

  return { config, audit };
}

export function getActiveProfile(state: any) {
  const profileName = state.activeProfile ?? state.config.activePermissionProfile;
  const profile = state.config.profiles?.[profileName] ?? {};
  const effectivePermissionProfile = state.config.effectivePermissionProfiles?.[profileName] ?? state.config.effectivePermissionProfile;
  if (!effectivePermissionProfile) throw new Error(`Permission profile '${profileName}' is not defined`);
  profile.effectivePermissionProfile = effectivePermissionProfile;
  return profile;
}

export function resolveRuntimeBaseDir(config: any, options: AnyRecord = {}) {
  const configured = options.runtimeBaseDir ?? config.runtime?.baseDir ?? EXTENSION_DATA_DIR;
  const expanded = expandHome(configured);
  return path.isAbsolute(expanded) ? expanded : path.join(os.homedir(), expanded);
}

export function resolveSrtSettingsDir(config: any, runtimeBaseDir: string) {
  const settingsDir = config.runtime?.settingsDir ?? "runtime";
  if (path.isAbsolute(settingsDir)) {
    throw new Error("runtime.settingsDir must be a relative path under runtime.baseDir");
  }
  const resolved = path.resolve(runtimeBaseDir, settingsDir);
  if (!isPathInside(runtimeBaseDir, resolved)) {
    throw new Error("runtime.settingsDir must stay under runtime.baseDir");
  }
  return resolved;
}

// Resolves the audit log file path under `runtimeBaseDir`. The default is
// `runtimeBaseDir/audit.jsonl`. `audit.file` MUST be a relative path; absolute paths and paths
// that escape `runtimeBaseDir` (e.g. `../escape.jsonl`) are rejected to keep the audit log
// inside the extension data directory and prevent polluting the project workspace.
export function resolveAuditFile(config: any, runtimeBaseDir: string): string {
  const file = config?.audit?.file ?? "audit.jsonl";
  if (typeof file !== "string" || file.length === 0) {
    throw new Error("audit.file must be a non-empty string");
  }
  if (path.isAbsolute(file)) {
    throw new Error("audit.file must be a relative path under runtime.baseDir");
  }
  const resolved = path.resolve(runtimeBaseDir, file);
  if (!isPathInside(runtimeBaseDir, resolved)) {
    throw new Error("audit.file must stay under runtime.baseDir");
  }
  return resolved;
}

function isPathInside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}
