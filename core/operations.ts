import path from "node:path";
import { parseShellOperations } from "./policy.ts";

// Built-in read-only command allowlist. These commands, when invoked with cwd-internal paths,
// are auto-allowed by the bash read-only quick path. The list deliberately excludes commands
// that can perform writes (e.g. `echo` is not included even though it does not write to files
// — keeping the allowlist narrow avoids accidental over-broadening).
export const READ_ONLY_COMMANDS: readonly string[] = [
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "stat",
  "file",
  "tree"
];

// `find` write flags that disqualify the command from being treated as read-only.
const FIND_WRITE_FLAGS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir"]);

// Returns the runtime read-only set: builtin + user `tools.bash.readOnlyCommands` (deduped).
// A missing or non-array value is treated as an empty list.
export function getEffectiveReadOnlyCommands(config: any): string[] {
  const userValue = config?.tools?.bash?.readOnlyCommands;
  const userCommands = Array.isArray(userValue) ? userValue.filter((item) => typeof item === "string") : [];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const cmd of READ_ONLY_COMMANDS) {
    if (!seen.has(cmd)) {
      seen.add(cmd);
      merged.push(cmd);
    }
  }
  for (const cmd of userCommands) {
    if (!seen.has(cmd)) {
      seen.add(cmd);
      merged.push(cmd);
    }
  }
  return merged;
}

// Conservative predicate: returns true if `command` is in the read-only set, with `find` write
// flags disqualifying the command.
export function isReadOnlyCommand(command: string, argv: string[], readOnlySet: Set<string>): boolean {
  if (!readOnlySet.has(command)) return false;
  if (command === "find") {
    for (const arg of argv ?? []) {
      if (FIND_WRITE_FLAGS.has(arg)) return false;
    }
  }
  return true;
}

// Conservative path extraction. Skips:
//   - long options (--xxx) and short options (-x, -xyz)
//   - option value forms: --key=value, --key value
//   - pure numeric tokens (line counts, byte counts)
//   - tokens containing $ / backticks / $() (variable expansion / command substitution)
export function extractReadOnlyPaths(argv: string[] = []): string[] {
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      // End-of-options marker; the rest are positional operands.
      for (let j = i + 1; j < argv.length; j += 1) {
        const next = argv[j];
        if (typeof next === "string" && isLikelyPath(next)) paths.push(next);
      }
      break;
    }
    if (arg.startsWith("--")) {
      // --flag or --flag=value. For --flag=value, the value half is not a path.
      if (arg.includes("=")) continue;
      // For --flag, the next token might be a value, but we treat it as option for safety.
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      // short option (or cluster like -lR). Skip the token and (heuristically) the next token.
      continue;
    }
    if (!isLikelyPath(arg)) continue;
    paths.push(arg);
  }
  return paths;
}

function isLikelyPath(token: string): boolean {
  if (!token) return false;
  if (/^\d+$/.test(token)) return false; // pure number
  if (token.includes("$") || token.includes("`")) return false; // variable / substitution
  // 仅有分隔符的 token 视为路径（包含 /、. 或 \）。避免把 -e pattern 之类的 value 误识为路径。
  if (!/[\/.\/]/.test(token)) return false;
  return true;
}

// Returns true if `target` resolves to a path inside `cwd` (not escaping via `..` or absolute path).
// A leading `~` is treated as external because the bash quick path is conservative about home expansion.
export function isPathInsideCwd(target: string, cwd: string): boolean {
  if (!target) return false;
  if (target.startsWith("~")) return false;
  if (target.startsWith("$")) return false;
  const absolute = path.resolve(cwd, target);
  const relative = path.relative(cwd, absolute);
  // relative 为空表示 target 就是 cwd 本身，视为内部。
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

// Evaluates a bash command against the read-only allowlist + cwd-internal path scope.
// Returns one of:
//   { action: "allow", reason, rule: { id: "read-only-allowlist" } }   — every operation matched
//   { action: "block", reason, rule: { id: "read-only-allowlist" } }   — a path hit denyRead
//   { action: "fallback", reason }                                    — caller should run evaluateToolCall
export function evaluateBashReadAccess({ config, profile, input, cwd }: { config: any; profile: any; input: any; cwd: string }): { action: "allow" | "block" | "fallback"; reason: string; rule?: { id: string }; target?: string } {
  const commandText = String(input?.command ?? "");
  if (!commandText) return { action: "fallback", reason: "empty command" };
  const operations = parseShellOperations(commandText);
  if (operations.length === 0) return { action: "fallback", reason: "no operations parsed" };

  const readOnlySet = new Set(getEffectiveReadOnlyCommands(config));
  const denyRead = profile?.sandbox?.filesystem?.denyRead ?? [];
  const denyReadEntries = (profile?.effectivePermissionProfile?.filesystem?.entries ?? []).filter((entry: any) => entry.access === "deny");

  for (const operation of operations) {
    if (!isReadOnlyCommand(operation.command, operation.argv, readOnlySet)) {
      return { action: "fallback", reason: `operation '${operation.command}' is not in read-only allowlist` };
    }
    // 先扫一遍 argv：遇到含 $ / 反引号 / $() 的参数表示存在变量或命令替换，
    // 这种命令无法被保守解析，应回退到原 evaluateToolCall。
    for (const arg of operation.argv.slice(1)) {
      if (typeof arg !== "string") continue;
      if (arg.includes("$") || arg.includes("`")) {
        return { action: "fallback", reason: `argument contains shell metacharacter: ${arg}` };
      }
    }
    const candidates = extractReadOnlyPaths(operation.argv.slice(1));
    if (candidates.length === 0) {
      // No path arguments (e.g. bare `ls`); only allow if the command's own cwd-relative semantics
      // are safe. We treat this as allow-by-default for read-only commands that do not take a path.
      continue;
    }
    for (const candidate of candidates) {
      if (!isPathInsideCwd(candidate, cwd)) {
        return { action: "fallback", reason: `path '${candidate}' is outside cwd` };
      }
      const normalized = path.relative(cwd, path.resolve(cwd, candidate));
      if (matchesAnyPath(denyRead, normalized) || matchesAnyPermissionEntry(denyReadEntries, normalized)) {
        return { action: "block", reason: `Path denied by filesystem policy: ${candidate}`, rule: { id: "read-only-allowlist" }, target: candidate };
      }
    }
  }
  return { action: "allow", reason: "matched read-only allowlist", rule: { id: "read-only-allowlist" } };
}

function matchesAnyPermissionEntry(entries: any[], target: string): boolean {
  return entries.some((entry) => {
    if (entry.scope !== ":workspace_roots" && entry.scope !== "path" && entry.scope !== ":root") return false;
    const pattern = entry.path === "." || entry.scope === ":root" ? "**" : entry.path;
    return globMatchPath(pattern, target) || (!pattern.includes("*") && globMatchPath(`${pattern}/**`, target));
  });
}

function matchesAnyPath(patterns: string[], target: string): boolean {
  for (const pattern of patterns) {
    if (globMatchPath(pattern, target)) return true;
  }
  return false;
}

function globMatchPath(pattern: string, target: string): boolean {
  const normalizedPattern = String(pattern).replace(/^\.\//, "");
  const normalizedTarget = String(target).replace(/^\.\//, "");
  if (normalizedPattern === normalizedTarget) return true;
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "%%DOUBLE_STAR%%")
    .replace(/\*/g, "[^/]*")
    .replace(/%%DOUBLE_STAR%%/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(normalizedTarget);
}

export const BUILTIN_OPERATION_RULES = {
  "rm.recursive": {
    id: "rm.recursive",
    category: "destructive-file",
    command: "rm",
    argvIncludes: ["-r"],
    reason: "Recursive delete requires confirmation."
  },
  "find.delete": {
    id: "find.delete",
    category: "destructive-file",
    command: "find",
    argvIncludes: ["-delete"],
    reason: "Bulk delete requires confirmation."
  },
  "permission.recursive": {
    id: "permission.recursive",
    category: "permission-change",
    command: ["chmod", "chown", "chflags", "setfacl"],
    argvIncludes: ["-R"],
    reason: "Recursive permission or ownership changes require confirmation."
  },
  "git.push": {
    id: "git.push",
    category: "git-write",
    command: "git",
    subcommands: ["push"],
    reason: "Remote git writes require confirmation."
  },
  "git.commit": {
    id: "git.commit",
    category: "git-write",
    command: "git",
    subcommands: ["commit"],
    reason: "Creating commits requires confirmation."
  },
  "git.reset-hard": {
    id: "git.reset-hard",
    category: "git-destructive",
    command: "git",
    subcommands: ["reset", "--hard"],
    reason: "Destructive git reset requires confirmation."
  },
  "git.clean": {
    id: "git.clean",
    category: "git-destructive",
    command: "git",
    subcommands: ["clean"],
    reason: "Git clean can delete untracked files and requires confirmation."
  },
  "git.hooks": {
    id: "git.hooks",
    category: "persistence-risk",
    commandIncludes: [".git/hooks", ".gitmodules"],
    reason: "Git hook and submodule mutation is blocked by default."
  },
  sudo: {
    id: "sudo",
    category: "privilege-escalation",
    command: ["sudo", "su"],
    reason: "Privilege escalation requires confirmation."
  },
  "process.control": {
    id: "process.control",
    category: "system-control",
    command: ["kill", "pkill", "killall", "launchctl", "systemctl"],
    reason: "System or process control requires confirmation."
  },
  "remote-script.curl": {
    id: "remote-script.curl",
    category: "remote-code-execution",
    commandIncludesAll: ["curl", "| sh"],
    reason: "Remote script execution requires confirmation."
  },
  "remote-script.wget": {
    id: "remote-script.wget",
    category: "remote-code-execution",
    commandIncludesAll: ["wget", "| bash"],
    reason: "Remote script execution requires confirmation."
  },
  eval: {
    id: "eval",
    category: "remote-code-execution",
    command: "eval",
    reason: "eval execution requires confirmation."
  },
  "credentials.read": {
    id: "credentials.read",
    category: "credential-access",
    commandIncludes: ["~/.ssh/", "gh auth token", "security find-generic-password"],
    reason: "Credential access is blocked by default."
  },
  "network.copy": {
    id: "network.copy",
    category: "network-exfiltration",
    command: ["scp", "rsync", "sftp", "nc"],
    reason: "Network copy or raw network transfer requires confirmation."
  },
  "curl.upload": {
    id: "curl.upload",
    category: "network-exfiltration",
    command: "curl",
    argvIncludes: ["-T"],
    reason: "curl upload requires confirmation."
  },
  "deps.install": {
    id: "deps.install",
    category: "supply-chain",
    command: ["npm", "pnpm", "yarn", "pip", "uv"],
    subcommands: ["install"],
    reason: "Dependency installation requires confirmation."
  },
  "package.publish": {
    id: "package.publish",
    category: "publishing",
    command: ["npm", "pnpm"],
    subcommands: ["publish"],
    reason: "Package publishing requires confirmation."
  },
  docker: {
    id: "docker",
    category: "container-control",
    command: ["docker", "podman"],
    reason: "Container runtime operations require confirmation."
  },
  infra: {
    id: "infra",
    category: "infrastructure-control",
    command: ["kubectl", "terraform", "aws", "gcloud", "az"],
    reason: "Cloud or cluster operations require confirmation."
  },
  "system.automation": {
    id: "system.automation",
    category: "system-automation",
    command: ["open", "osascript"],
    reason: "System automation requires confirmation."
  }
};

export const BUILTIN_OPERATION_PRESETS = {
  recommended: {
    confirm: [
      "rm -r",
      "find -delete",
      "chmod -R",
      "chown -R",
      "chflags -R",
      "setfacl -R",
      "git push",
      "git commit",
      "git reset --hard",
      "git clean",
      "sudo",
      "su",
      "kill",
      "pkill",
      "killall",
      "launchctl",
      "systemctl",
      "curl | sh",
      "wget | bash",
      "eval",
      "scp",
      "rsync",
      "sftp",
      "nc",
      "curl -T",
      "npm install",
      "pnpm install",
      "yarn install",
      "pip install",
      "uv install",
      "npm publish",
      "pnpm publish",
      "docker",
      "podman",
      "kubectl",
      "terraform",
      "aws",
      "gcloud",
      "az",
      "open",
      "osascript"
    ],
    block: ["~/.ssh/", "gh auth token", "security find-generic-password", ".git/hooks", ".gitmodules"],
    allow: []
  }
};

export function normalizeOperations(value: any): any[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;

  const policy = typeof value === "string" ? { preset: value } : value;
  const rules = new Map();
  const preset = BUILTIN_OPERATION_PRESETS[policy.preset] ?? { confirm: [], block: [], allow: [] };

  applyOperationGroup(rules, preset.confirm, "confirm");
  applyOperationGroup(rules, preset.block, "block");
  applyOperationGroup(rules, preset.allow, "allow");
  applyOperationGroup(rules, policy.confirm, "confirm");
  applyOperationGroup(rules, policy.block, "block");
  applyOperationGroup(rules, policy.allow, "allow");

  for (const rule of policy.advanced ?? []) {
    if (rule?.id) rules.set(rule.id, rule);
  }

  return [...rules.values()];
}

function applyOperationGroup(rules: Map<string, any>, entries: any[] = [], action: string) {
  for (const entry of entries) {
    const rawToken = typeof entry === "string" ? entry : entry.command;
    const tokens = expandOperationToken(rawToken);
    for (const token of tokens) {
      const template = BUILTIN_OPERATION_RULES[token] ?? operationPatternToRule(token);
      if (!template) continue;
      const rule = { ...template, ...(typeof entry === "object" ? entry : {}), id: template.id, action };
      rules.set(rule.id, rule);
    }
  }
}

function expandOperationToken(token: string) {
  if (!token) return [];
  if (!token.endsWith(".*")) return [token];
  const prefix = token.slice(0, -1);
  return Object.keys(BUILTIN_OPERATION_RULES).filter((key) => key.startsWith(prefix));
}

function operationPatternToRule(pattern: string) {
  if (!pattern || typeof pattern !== "string") return undefined;
  const trimmed = pattern.trim();
  if (!trimmed) return undefined;

  if (trimmed.includes("|")) {
    const parts = trimmed.split("|").map((part) => part.trim()).filter(Boolean);
    return {
      id: `pattern:${trimmed}`,
      category: "command-pattern",
      commandIncludesAll: parts,
      reason: `Command pattern '${trimmed}' requires permission.`
    };
  }

  const argv = splitPattern(trimmed);
  const command = argv[0];
  const rest = argv.slice(1);
  if (isCommandFragment(trimmed, command)) {
    return {
      id: `pattern:${trimmed}`,
      category: "command-fragment",
      commandIncludes: [trimmed],
      reason: `Command fragment '${trimmed}' requires permission.`
    };
  }
  return {
    id: `pattern:${trimmed}`,
    category: "command-pattern",
    command,
    subcommands: rest.filter((arg) => !arg.startsWith("-")),
    argvIncludes: rest.filter((arg) => arg.startsWith("-")),
    reason: `Command pattern '${trimmed}' requires permission.`
  };
}

function splitPattern(pattern: string) {
  return pattern.split(/\s+/).filter(Boolean);
}

function isCommandFragment(pattern: string, command: string) {
  return pattern.includes("/") || pattern.startsWith(".") || pattern.startsWith("~") || !/^[A-Za-z0-9_-]+$/.test(command);
}
