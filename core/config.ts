import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { normalizeOperations } from "./operations.ts";

export const EXTENSION_DIR = ".";
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
  if (!config?.activeProfile || typeof config.activeProfile !== "string") errors.push("activeProfile must be a string");
  if (!config?.profiles || typeof config.profiles !== "object") errors.push("profiles must be an object");
  if (!config?.tools || typeof config.tools !== "object") errors.push("tools must be an object");
  if (config?.activeProfile && config?.profiles && !config.profiles[config.activeProfile]) {
    errors.push(`activeProfile '${config.activeProfile}' is not defined`);
  }
  for (const [name, profile] of Object.entries(config?.profiles ?? {}) as Array<[string, AnyRecord]>) {
    if (!profile?.sandbox) errors.push(`profiles.${name}.sandbox is required`);
    const fsPolicy = profile?.sandbox?.filesystem;
    const netPolicy = profile?.sandbox?.network;
    for (const field of ["denyRead", "allowRead", "allowWrite", "denyWrite"]) {
      if (!Array.isArray(fsPolicy?.[field])) errors.push(`profiles.${name}.sandbox.filesystem.${field} must be an array`);
    }
    for (const field of ["allowedDomains", "deniedDomains"]) {
      if (!Array.isArray(netPolicy?.[field])) errors.push(`profiles.${name}.sandbox.network.${field} must be an array`);
    }
  }
  if (errors.length) {
    const error: any = new Error(`Invalid pi-perm config:\n- ${errors.join("\n- ")}`);
    error.errors = errors;
    throw error;
  }
  return config;
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
  for (const policy of Object.values(config.tools ?? {}) as AnyRecord[]) {
    if (policy.operations !== undefined) {
      policy.operations = normalizeOperations(policy.operations);
    }
  }
  return config;
}

export function applySecurityBoundary(config: any, sources: AnyRecord = {}) {
  const user = sources.user ?? {};
  const audit = [];
  const userProfiles = user.profiles ?? {};
  const highRisk = [
    "allowAppleEvents",
    "enableWeakerNestedSandbox",
    "enableWeakerNetworkIsolation",
    "allowAllUnixSockets"
  ];
  const dockerSocket = "/var/run/docker.sock";

  for (const [profileName, profile] of Object.entries(config.profiles ?? {}) as Array<[string, AnyRecord]>) {
    const sandbox = profile.sandbox ?? {};
    const network = sandbox.network ?? {};
    const userSandbox = userProfiles[profileName]?.sandbox ?? {};
    const userNetwork = userSandbox.network ?? {};

    for (const key of highRisk) {
      if (sandbox[key] === true && userSandbox[key] !== true) {
        sandbox[key] = false;
        audit.push({ type: "downgrade", profile: profileName, key, reason: "requires user config" });
      }
      if (key === "allowAllUnixSockets" && network[key] === true && userNetwork[key] !== true) {
        network[key] = false;
        audit.push({ type: "downgrade", profile: profileName, key: `network.${key}`, reason: "requires user config" });
      }
    }

    const sockets = Array.isArray(network.allowUnixSockets) ? network.allowUnixSockets : [];
    if (sockets.includes(dockerSocket) && !(userNetwork.allowUnixSockets ?? []).includes(dockerSocket)) {
      network.allowUnixSockets = sockets.filter((socket) => socket !== dockerSocket);
      audit.push({ type: "downgrade", profile: profileName, key: "network.allowUnixSockets", value: dockerSocket, reason: "requires user config" });
    }
  }

  return { config, audit };
}

export function getActiveProfile(state: any) {
  const profile = state.config.profiles[state.activeProfile ?? state.config.activeProfile];
  if (!profile) throw new Error(`Profile '${state.activeProfile}' is not defined`);
  return profile;
}
