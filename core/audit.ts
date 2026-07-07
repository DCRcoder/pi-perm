import fs from "node:fs";
import path from "node:path";

export function auditEvent(config: any, event: any, auditFile: string) {
  if (!config.audit?.enabled) return;
  if (!auditFile) return;
  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.appendFileSync(auditFile, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}
