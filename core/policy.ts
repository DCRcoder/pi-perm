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
  const action = rule?.action ?? policy.defaultAction ?? "allow";
  const reason = rule?.reason ?? (rule ? `Matched rule ${rule.id}` : `Default action ${action}`);

  if (!rule && toolName === "bash") {
    const operation = findMatchingOperation(policy.operations ?? [], input?.command ?? "");
    if (operation) {
      const operationAction = operation.action ?? policy.defaultAction ?? "allow";
      const operationReason = operation.reason ?? `Matched operation ${operation.id}`;
      if (policy.mode === "observe") {
        return { action: "allow", policy, operation, rule: operation, observedAction: operationAction, reason: operationReason };
      }
      return { action: operationAction, policy, operation, rule: operation, reason: operationReason, target: operation.summary };
    }
  }

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

  const fsPolicy = profile.sandbox.filesystem;
  for (const target of targets) {
    const normalized = normalizeForMatch(target, cwd);
    const deniedWrite = ["write", "edit"].includes(toolName) && matchesAny(fsPolicy.denyWrite, normalized);
    const deniedRead = toolName === "read" && matchesAny(fsPolicy.denyRead, normalized) && !matchesAny(fsPolicy.allowRead, normalized);
    if (deniedWrite || deniedRead) {
      return { action: "block", policy, target, reason: `Path denied by filesystem policy: ${target}` };
    }
  }
  const decision = evaluateToolCall({ config, profile, toolName, input });
  return { ...decision, target: decision.target ?? targets.join(", ") };
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
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  const normalizedTarget = target.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalizedPattern === normalizedTarget) return true;
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "%%DOUBLE_STAR%%")
    .replace(/\*/g, "[^/]*")
    .replace(/%%DOUBLE_STAR%%/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(normalizedTarget);
}

export function summarizePolicy(state: any) {
  const profile = state.config.profiles[state.activeProfile];
  const sandbox = profile.sandbox;
  return {
    activeProfile: state.activeProfile,
    profiles: Object.keys(state.config.profiles),
    tools: Object.fromEntries((Object.entries(state.config.tools) as Array<[string, AnyRecord]>).map(([name, policy]) => [name, { mode: policy.mode, defaultAction: policy.defaultAction, wrapWithSrt: Boolean(policy.wrapWithSrt), operations: policy.operations?.length ?? 0 }])),
    filesystem: sandbox.filesystem,
    network: sandbox.network,
    highRisk: {
      allowAppleEvents: Boolean(sandbox.allowAppleEvents),
      enableWeakerNestedSandbox: Boolean(sandbox.enableWeakerNestedSandbox),
      enableWeakerNetworkIsolation: Boolean(sandbox.enableWeakerNetworkIsolation),
      allowAllUnixSockets: Boolean(sandbox.network?.allowAllUnixSockets)
    }
  };
}
