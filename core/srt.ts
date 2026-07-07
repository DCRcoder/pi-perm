import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function toSrtSettings(profile: any) {
  if (profile.effectivePermissionProfile) {
    const permission = profile.effectivePermissionProfile;
    return {
      network: networkSettings(permission.network ?? {}),
      filesystem: filesystemSettings(permission.filesystem?.entries ?? []),
      ignoreViolations: {},
      enableWeakerNestedSandbox: Boolean(permission.dangerous?.enableWeakerNestedSandbox),
      enableWeakerNetworkIsolation: Boolean(permission.dangerous?.enableWeakerNetworkIsolation),
      allowAppleEvents: Boolean(permission.dangerous?.allowAppleEvents)
    };
  }
  const sandbox = profile.sandbox;
  return {
    network: sandbox.network,
    filesystem: sandbox.filesystem,
    ignoreViolations: sandbox.ignoreViolations ?? {},
    enableWeakerNestedSandbox: Boolean(sandbox.enableWeakerNestedSandbox),
    enableWeakerNetworkIsolation: Boolean(sandbox.enableWeakerNetworkIsolation),
    allowAppleEvents: Boolean(sandbox.allowAppleEvents)
  };
}

function networkSettings(network: any) {
  const domains = Object.entries(network.domains ?? {});
  const unixSockets = Object.entries(network.unixSockets ?? {});
  return {
    enabled: Boolean(network.enabled),
    allowedDomains: domains.filter(([, action]) => action === "allow").map(([domain]) => domain),
    deniedDomains: domains.filter(([, action]) => action === "deny").map(([domain]) => domain),
    allowUnixSockets: unixSockets.filter(([, action]) => action === "allow").map(([socket]) => socket),
    denyUnixSockets: unixSockets.filter(([, action]) => action === "deny").map(([socket]) => socket),
    allowLocalBinding: Boolean(network.allowLocalBinding)
  };
}

function filesystemSettings(entries: any[]) {
  const filesystem = { denyRead: [] as string[], allowRead: [] as string[], allowWrite: [] as string[], denyWrite: [] as string[] };
  for (const entry of entries) {
    const target = srtPath(entry);
    if (!target) continue;
    if (entry.access === "deny") {
      filesystem.denyRead.push(target);
      filesystem.denyWrite.push(target);
    } else if (entry.access === "write") {
      filesystem.allowRead.push(target);
      filesystem.allowWrite.push(target);
    } else if (entry.access === "read") {
      filesystem.allowRead.push(target);
    }
  }
  return filesystem;
}

function srtPath(entry: any) {
  if (entry.scope === ":minimal") return undefined;
  if (entry.scope === ":workspace_roots") return entry.path;
  if (entry.scope === ":tmpdir") return "$TMPDIR";
  if (entry.scope === ":slash_tmp") return "/tmp";
  if (entry.scope === ":root") return "/";
  return entry.path;
}

export function writeSrtSettings({ profile, settingsDir, toolCallId = "manual" }: any) {
  fs.mkdirSync(settingsDir, { recursive: true });
  const filePath = path.join(settingsDir, `${sanitizeFileName(toolCallId)}.srt-settings.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(toSrtSettings(profile), null, 2)}\n`);
  return filePath;
}

export function commandExists(binary: string) {
  const result = spawnSync(binary, ["--help"], { stdio: "ignore" });
  return result.status === 0 || result.status === 1;
}

export function wrapCommandWithSrt(command: string, settingsPath: string, srtBinary = "srt") {
  return `${shellQuote(srtBinary)} --settings ${shellQuote(settingsPath)} ${command}`;
}

export function shellQuote(value: any) {
  const text = String(value);
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function sanitizeFileName(value: any) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, "_");
}
