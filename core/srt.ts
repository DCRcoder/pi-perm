import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function toSrtSettings(profile: any) {
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

export function writeSrtSettings({ profile, cwd, runtimeDir, toolCallId = "manual" }: any) {
  const baseDir = path.resolve(cwd, runtimeDir);
  fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, `${sanitizeFileName(toolCallId)}.srt-settings.json`);
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
