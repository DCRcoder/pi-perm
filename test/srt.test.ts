import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shellQuote, toSrtSettings, wrapCommandWithSrt, writeSrtSettings } from "../core/srt.ts";

const profile = {
  sandbox: {
    network: { allowedDomains: ["github.com"], deniedDomains: [], allowUnixSockets: [] },
    filesystem: { denyRead: ["~/.ssh"], allowRead: ["."], allowWrite: ["."], denyWrite: [".env"] },
    ignoreViolations: {},
    allowAppleEvents: false
  }
};

test("toSrtSettings maps profile sandbox to sandbox-runtime settings", () => {
  const settings = toSrtSettings(profile);
  assert.deepEqual(settings.network.allowedDomains, ["github.com"]);
  assert.deepEqual(settings.filesystem.denyWrite, [".env"]);
  assert.equal(settings.allowAppleEvents, false);
});

test("writeSrtSettings writes settings under configured runtime directory", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-perm-srt-"));
  const settingsDir = path.join(cwd, "runtime");
  const file = writeSrtSettings({ profile, settingsDir, toolCallId: "call/1" });
  assert.equal(file.includes("runtime"), true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).network.allowedDomains[0], "github.com");
});

test("wrapCommandWithSrt preserves original command after quoted settings", () => {
  const command = wrapCommandWithSrt("echo 'hello world'", "/tmp/with space/settings.json", "srt");
  assert.equal(command, "srt --settings '/tmp/with space/settings.json' echo 'hello world'");
});

test("shellQuote escapes single quotes", () => {
  assert.equal(shellQuote("/tmp/it's.json"), "'/tmp/it'\\''s.json'");
});
