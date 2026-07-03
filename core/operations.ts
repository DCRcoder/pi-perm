export const OPERATION_ALIASES = {
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

export const OPERATION_PRESETS = {
  recommended: {
    confirm: [
      "rm.recursive",
      "find.delete",
      "permission.recursive",
      "git.push",
      "git.commit",
      "git.reset-hard",
      "git.clean",
      "sudo",
      "process.control",
      "remote-script.*",
      "network.*",
      "deps.install",
      "package.publish",
      "docker",
      "infra",
      "system.automation"
    ],
    block: ["git.hooks", "credentials.read"],
    allow: []
  }
};

export function normalizeOperations(value: any): any[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;

  const policy = typeof value === "string" ? { preset: value } : value;
  const rules = new Map();
  const preset = OPERATION_PRESETS[policy.preset] ?? { confirm: [], block: [], allow: [] };

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
    const rawToken = typeof entry === "string" ? entry : entry.alias ?? entry.command;
    const tokens = expandOperationToken(rawToken);
    for (const token of tokens) {
      const template = OPERATION_ALIASES[token] ?? operationPatternToRule(token);
      if (!template) continue;
      const rule = { ...template, ...(typeof entry === "object" ? entry : {}), id: template.id, action };
      delete rule.alias;
      rules.set(rule.id, rule);
    }
  }
}

function expandOperationToken(token: string) {
  if (!token) return [];
  if (!token.endsWith(".*")) return [token];
  const prefix = token.slice(0, -1);
  return Object.keys(OPERATION_ALIASES).filter((key) => key.startsWith(prefix));
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
