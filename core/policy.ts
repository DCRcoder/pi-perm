import path from "node:path";
type AnyRecord = Record<string, any>;

export function getToolPolicy(config: any, profile: any, toolName: string) {
  const defaults = profile.toolDefaults ?? {};
  return {
    mode: "off",
    defaultAction: "allow",
    ...defaults,
    ...(config.tools?.[toolName] ?? {})
  };
}

export function evaluateToolCall({ config, profile, toolName, input }: AnyRecord): any {
  const policy = getToolPolicy(config, profile, toolName);
  if (policy.mode === "off") return { action: "allow", policy, reason: "tool policy is off" };

  const rule = findMatchingRule(policy.rules ?? [], { toolName, input });
  if (rule && ["block", "confirm"].includes(rule.action)) {
    const action = rule.action ?? policy.defaultAction ?? "allow";
    const reason = rule.reason ?? `Matched rule ${rule.id}`;
    if (policy.mode === "observe") return { action: "allow", policy, rule, observedAction: action, reason };
    return { action, policy, rule, reason };
  }

  if (toolName === "bash") {
    const operation = findMatchingOperation(policy.operations ?? [], input?.command ?? "");
    if (operation) {
      const operationAction = operation.action ?? policy.defaultAction ?? "allow";
      const operationReason = operation.reason ?? `Matched operation ${operation.id}`;
      if (policy.mode === "observe") {
        return { action: "allow", policy, operation, rule: operation, observedAction: operationAction, reason: operationReason };
      }
      return { action: operationAction, policy, operation, rule: operation, reason: operationReason, target: operation.summary };
    }
    const boundary = evaluateBashBoundary({ config, profile, input, policy });
    if (boundary) return boundary;
  }

  const action = rule?.action ?? policy.defaultAction ?? "allow";
  const reason = rule?.reason ?? (rule ? `Matched rule ${rule.id}` : `Default action ${action}`);

  if (policy.mode === "observe") {
    return { action: "allow", policy, rule, observedAction: action, reason };
  }
  return { action, policy, rule, reason };
}

export function findMatchingOperation(operations: any[], commandText: string) {
  const parsed = parseShellOperations(commandText);
  return operations
    .map((rule) => {
      const operation = parsed.find((item) => operationMatches(rule, item, commandText));
      return operation ? { ...rule, summary: operation.raw } : undefined;
    })
    .find(Boolean);
}

export function operationMatches(rule: any, operation: any, rawCommand: string) {
  const commands = toArray(rule.command);
  if (commands.length > 0 && !commands.includes(operation.command)) return false;

  const commandIncludes = toArray(rule.commandIncludes);
  if (commandIncludes.length > 0 && !commandIncludes.some((part) => rawCommand.includes(part))) return false;

  const commandIncludesAll = toArray(rule.commandIncludesAll);
  if (commandIncludesAll.length > 0 && !commandIncludesAll.every((part) => rawCommand.includes(part))) return false;

  const subcommands = toArray(rule.subcommands);
  if (subcommands.length > 0 && !subcommands.every((part) => operation.argv.slice(1).includes(part))) return false;

  const argvIncludes = toArray(rule.argvIncludes);
  if (argvIncludes.length > 0 && !argvIncludes.every((part) => operation.argv.some((arg) => arg.includes(part)))) return false;

  return commands.length > 0 || commandIncludes.length > 0 || commandIncludesAll.length > 0;
}

export function parseShellOperations(commandText: string) {
  const tokens = tokenizeShell(commandText);
  const operations = [];
  let current = [];
  for (const token of tokens) {
    if (["&&", "||", ";", "|"].includes(token)) {
      pushOperation(operations, current);
      current = [];
    } else {
      current.push(token);
    }
  }
  pushOperation(operations, current);
  return operations;
}

function pushOperation(operations: any[], argv: string[]) {
  const filtered = argv.filter(Boolean);
  if (filtered.length === 0) return;
  operations.push({ command: filtered[0], argv: filtered, raw: filtered.join(" ") });
}

export function tokenizeShell(commandText: string) {
  const tokens = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < String(commandText).length; i += 1) {
    const char = commandText[i];
    const next = commandText[i + 1];
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    if ((char === "&" && next === "&") || (char === "|" && next === "|")) {
      if (current) tokens.push(current);
      tokens.push(`${char}${next}`);
      current = "";
      i += 1;
      continue;
    }
    if (char === ";" || char === "|") {
      if (current) tokens.push(current);
      tokens.push(char);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function toArray(value: any) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function findMatchingRule(rules: any[], call: any) {
  return rules.find((rule) => ruleMatches(rule, call));
}

export function ruleMatches(rule: any, { toolName, input }: AnyRecord) {
  const match = rule.match ?? {};
  if (match.toolNames?.length && !match.toolNames.includes(toolName)) return false;
  if (match.commandIncludes?.length) {
    const command = String(input?.command ?? "");
    if (!match.commandIncludes.some((part) => command.includes(part))) return false;
  }
  if (match.pathGlobs?.length) {
    const paths = extractPaths(input, ["path", "file_path"]);
    if (!paths.some((target) => match.pathGlobs.some((glob) => globMatch(glob, target)))) return false;
  }
  return true;
}

export function extractPaths(input: any, fields: string[] = []) {
  const paths = [];
  for (const field of fields) {
    const value = input?.[field];
    if (typeof value === "string") paths.push(value);
    if (Array.isArray(value)) paths.push(...value.filter((item) => typeof item === "string"));
  }
  return paths;
}

export function evaluateFileAccess({ config, profile, toolName, input, cwd = process.cwd() }: AnyRecord): any {
  const policy = getToolPolicy(config, profile, toolName);
  const fields = policy.pathFields ?? ["path", "file_path"];
  const targets = extractPaths(input, fields);
  if (targets.length === 0) return { action: policy.defaultAction ?? "allow", policy, reason: "No configured path fields found" };

  const permissionProfile = getEffectivePermissionProfile(config, profile);
  if (permissionProfile) {
    const decisions = targets.map((target) => ({ target, access: resolveFilesystemAccess(permissionProfile, target, cwd) }));
    const denied = decisions.find((decision) => decision.access === "deny");
    if (denied) return { action: "block", policy, target: denied.target, reason: `Path denied by permission profile: ${denied.target}` };
    if (toolName === "read") {
      const allReadable = decisions.every((decision) => decision.access === "read" || decision.access === "write");
      if (allReadable) return { action: "allow", policy, target: targets.join(", "), reason: "Path readable by permission profile" };
    }
    if (["write", "edit"].includes(toolName)) {
      const allWritable = decisions.every((decision) => decision.access === "write");
      if (allWritable) return { action: "allow", policy, target: targets.join(", "), reason: "Path writable by permission profile" };
      return {
        action: "confirm",
        policy,
        rule: { id: "external-file-write-boundary" },
        targets,
        target: targets.join(", "),
        reason: `Path requires user confirmation by permission profile: ${targets.join(", ")}`
      };
    }
    const decision = evaluateToolCall({ config, profile, toolName, input });
    return { ...decision, target: decision.target ?? targets.join(", ") };
  }

  const fsPolicy = profile.sandbox.filesystem;
  for (const target of targets) {
    const normalized = normalizeForMatch(target, cwd);
    const deniedWrite = ["write", "edit"].includes(toolName) && matchesAny(fsPolicy.denyWrite, normalized);
    const deniedRead = toolName === "read" && matchesAny(fsPolicy.denyRead, normalized);
    if (deniedWrite || deniedRead) {
      return { action: "block", policy, target, reason: `Path denied by filesystem policy: ${target}` };
    }
  }

  // read 工具：对 cwd 内路径默认放行，避免每个项目文件读取都需要在 allowRead 中显式声明。
  // cwd 外路径仍按 allowRead 匹配；denyRead 已在上方处理。
  if (toolName === "read" && targets.length > 0) {
    const allInsideCwd = targets.every((target) => isPathInsideCwdForRead(target, cwd));
    if (allInsideCwd) {
      return { action: "allow", policy, target: targets.join(", "), reason: "Path inside cwd is auto-allowed for read tool" };
    }
    const allowReadHit = targets.some((target) => matchesAny(fsPolicy.allowRead, normalizeForMatch(target, cwd)));
    if (allowReadHit) {
      return { action: "allow", policy, target: targets.join(", "), reason: "Path matched allowRead pattern" };
    }
  }

  if (["write", "edit"].includes(toolName) && targets.length > 0) {
    const allowWriteHit = targets.every((target) => matchesAny(fsPolicy.allowWrite, normalizeForMatch(target, cwd)));
    if (allowWriteHit) {
      return { action: "allow", policy, target: targets.join(", "), reason: "Path matched allowWrite pattern" };
    }
  }

  const decision = evaluateToolCall({ config, profile, toolName, input });
  return { ...decision, target: decision.target ?? targets.join(", ") };
}

function getEffectivePermissionProfile(config: any, profile: any) {
  return profile?.effectivePermissionProfile ?? config?.effectivePermissionProfile;
}

function evaluateBashBoundary({ config, profile, input, policy }: AnyRecord) {
  const permissionProfile = getEffectivePermissionProfile(config, profile);
  if (!permissionProfile) return undefined;
  const command = String(input?.command ?? "");
  const operations = parseShellOperations(command);
  const networkOperation = operations.find((operation) => operationMayUseNetwork(operation));
  if (networkOperation && permissionProfile.network?.enabled === false) {
    return {
      action: "confirm",
      policy,
      rule: { id: "network-disabled-boundary" },
      reason: `Network is disabled by permission profile for '${networkOperation.command}'`,
      target: networkOperation.raw
    };
  }
  return undefined;
}

function operationMayUseNetwork(operation: any) {
  const command = operation.command;
  if (new Set(["curl", "wget", "scp", "rsync", "sftp", "nc", "docker", "kubectl", "terraform", "aws", "gcloud", "az", "gh"]).has(command)) return true;
  if (new Set(["npm", "pnpm", "yarn", "bun"]).has(command)) {
    return operation.argv.slice(1).some((arg: string) => ["install", "add", "publish", "outdated", "audit", "update", "upgrade"].includes(arg));
  }
  return false;
}

export function resolveFilesystemAccess(permissionProfile: any, target: string, cwd = process.cwd()) {
  const matches = [];
  for (const entry of permissionProfile?.filesystem?.entries ?? []) {
    const pattern = entryPattern(entry);
    const normalized = normalizeEntryTargetForMatch(entry, target, cwd);
    if (pattern !== undefined && entryMatches(pattern, normalized)) matches.push(entry);
  }
  if (matches.length === 0) return undefined;
  matches.sort(comparePermissionEntries);
  return matches[0].access;
}

function normalizeEntryTargetForMatch(entry: any, target: string, cwd: string) {
  if (entry.scope !== ":workspace_roots") return normalizeForMatch(target, cwd);
  if (!target || target === "~" || target.startsWith("~/")) return undefined;
  const absolute = path.resolve(cwd, target);
  const relative = path.relative(cwd, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative || ".";
}

function entryMatches(pattern: string, target: string | undefined) {
  if (target === undefined) return false;
  if (globMatch(pattern, target)) return true;
  if (!pattern.includes("*") && pattern !== "." && globMatch(`${pattern}/**`, target)) return true;
  return false;
}

function entryPattern(entry: any) {
  if (entry.scope === ":workspace_roots") return entry.path === "." ? "**" : entry.path;
  if ([":tmpdir", ":slash_tmp", ":minimal"].includes(entry.scope)) return undefined;
  if (entry.scope === ":root") return "**";
  if (entry.scope === "path") return entry.path;
  return entry.path;
}

function comparePermissionEntries(a: any, b: any) {
  const specificity = permissionSpecificity(b) - permissionSpecificity(a);
  if (specificity !== 0) return specificity;
  return accessRank(b.access) - accessRank(a.access);
}

function permissionSpecificity(entry: any) {
  if (entry.path === ".") return 0;
  return entry.specificity ?? 0;
}

function accessRank(access: string) {
  if (access === "deny") return 3;
  if (access === "write") return 2;
  if (access === "read") return 1;
  return 0;
}

function isPathInsideCwdForRead(target: string, cwd: string): boolean {
  if (!target) return false;
  if (target.startsWith("~") || target.startsWith("$")) return false;
  const absolute = path.resolve(cwd, target);
  const relative = path.relative(cwd, absolute);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function normalizeForMatch(target: string, cwd: string) {
  if (!target) return "";
  const absolute = target.startsWith("~") ? target : path.resolve(cwd, target);
  const relative = path.relative(cwd, absolute);
  return relative && !relative.startsWith("..") ? relative : target;
}

export function matchesAny(patterns: string[] = [], target: string) {
  return patterns.some((pattern) => globMatch(pattern, target));
}

export function globMatch(pattern: string, target: string) {
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.\//, "") === ".**" ? "**" : pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalizedPattern === normalizedTarget) return true;
  if (normalizedPattern.startsWith("**/") && globMatch(normalizedPattern.slice(3), normalizedTarget)) return true;
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "%%DOUBLE_STAR%%")
    .replace(/\*/g, "[^/]*")
    .replace(/%%DOUBLE_STAR%%/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(normalizedTarget);
}

export function summarizePolicy(state: any) {
  const profileName = state.activeProfile ?? state.config.activePermissionProfile;
  const permissionProfile = state.config.effectivePermissionProfiles?.[profileName] ?? state.config.effectivePermissionProfile;
  return {
    activeProfile: profileName,
    activePermissionProfile: profileName,
    profiles: Object.keys(state.config.permissions ?? {}),
    tools: Object.fromEntries((Object.entries(state.config.tools) as Array<[string, AnyRecord]>).map(([name, policy]) => [name, { mode: policy.mode, defaultAction: policy.defaultAction, wrapWithSrt: Boolean(policy.wrapWithSrt), operations: policy.operations?.length ?? 0 }])),
    filesystem: permissionProfile?.filesystem,
    network: permissionProfile?.network,
    highRisk: {
      allowAppleEvents: Boolean(permissionProfile?.dangerous?.allowAppleEvents),
      enableWeakerNestedSandbox: Boolean(permissionProfile?.dangerous?.enableWeakerNestedSandbox),
      enableWeakerNetworkIsolation: Boolean(permissionProfile?.dangerous?.enableWeakerNetworkIsolation),
      allowAllUnixSockets: Boolean(permissionProfile?.dangerous?.allowAllUnixSockets)
    }
  };
}
