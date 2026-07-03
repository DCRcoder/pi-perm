import fs from "node:fs";
import path from "node:path";

export function auditEvent(config: any, event: any, cwd = process.cwd()) {
  if (!config.audit?.enabled) return;
  const file = path.resolve(cwd, config.audit.file ?? "audit.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}
