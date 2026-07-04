import path from "node:path";
import { loadConfig, getActiveProfile, resolveRuntimeBaseDir, resolveSrtSettingsDir } from "./config.ts";
import { auditEvent } from "./audit.ts";
import { evaluateFileAccess, evaluateToolCall, summarizePolicy } from "./policy.ts";
import { commandExists, wrapCommandWithSrt, writeSrtSettings } from "./srt.ts";

export function createPiPermExtension(options: any = {}) {
  const loaded = loadConfig(options);
  const runtimeBaseDir = resolveRuntimeBaseDir(loaded.config, options);
  const state = {
    config: loaded.config,
    activeProfile: loaded.config.activeProfile,
    cwd: options.cwd ?? process.cwd(),
    runtimeBaseDir,
    srtSettingsDir: resolveSrtSettingsDir(loaded.config, runtimeBaseDir),
    now: options.now ?? (() => Date.now()),
    commandExists: options.commandExists ?? commandExists,
    events: options.events,
    sessionAllows: new Map<string, { lastUsedAt: number }>()
  };
  for (const event of loaded.audit) auditEvent(state.config, event, state.cwd);
  return {
    state,
    async handleToolCall(event, ctx = {}) {
      return handleToolCall(state, event, ctx);
    },
    handlePiPermCommand(args, ctx = {}) {
      return handlePiPermCommand(state, args, ctx);
    },
    policySummary() {
      return summarizePolicy(state);
    }
  };
}

export async function handleToolCall(state: any, event: any, ctx: any = {}) {
  // 实现参考：Extension 运行时状态目录 / Session 授权空闲过期
  pruneExpiredSessionAllows(state);
  const profile = getActiveProfile(state);
  const toolName = event.toolName;
  const input = event.input ?? {};
  const isFileTool = ["read", "write", "edit"].includes(toolName);
  const decision = isFileTool
    ? evaluateFileAccess({ config: state.config, profile, toolName, input, cwd: state.cwd })
    : evaluateToolCall({ config: state.config, profile, toolName, input });

  auditEvent(state.config, { type: "decision", toolName, action: decision.action, reason: decision.reason, ruleId: (decision as any).rule?.id }, state.cwd);

  if (decision.action === "block") {
    return { block: true, reason: decision.reason };
  }

  if (decision.action === "confirm") {
    const target = decision.target ?? input.command ?? toolName;
    const sessionKey = createSessionAllowKey(state.activeProfile, toolName, decision, target);
    const sessionAllow = state.sessionAllows.get(sessionKey);
    if (sessionAllow) {
      sessionAllow.lastUsedAt = state.now();
      auditEvent(state.config, { type: "session_allow_hit", toolName, target, key: sessionKey }, state.cwd);
    } else {
      const result = await confirmDecision(ctx, state.config, state.events, toolName, target);
      const ok = result.action === "allow_once" || result.action === "allow_session";
      auditEvent(state.config, { type: "confirm", toolName, allowed: ok, target, scope: result.action, key: result.action === "allow_session" ? sessionKey : undefined, expires: result.action === "allow_session" ? "session" : "call" }, state.cwd);
      if (!ok) return { block: true, reason: `Denied by user: ${toolName}` };
      if (result.action === "allow_session" && getSessionAllowTtlMs(state) > 0) {
        state.sessionAllows.set(sessionKey, { lastUsedAt: state.now() });
      }
    }
  }

  if (toolName === "bash" && decision.policy.wrapWithSrt) {
    if (!state.commandExists(decision.policy.srtBinary ?? "srt")) {
      const reason = `srt binary not found: ${decision.policy.srtBinary ?? "srt"}`;
      auditEvent(state.config, { type: "block", toolName, reason }, state.cwd);
      ctx.ui?.notify?.(reason, "error");
      return { block: true, reason };
    }
    const settingsPath = writeSrtSettings({ profile, settingsDir: state.srtSettingsDir, toolCallId: event.toolCallId ?? "bash" });
    event.input.command = wrapCommandWithSrt(input.command, settingsPath, decision.policy.srtBinary ?? "srt");
    auditEvent(state.config, { type: "srt_settings", toolName, settingsPath: formatAuditPath(state.cwd, settingsPath) }, state.cwd);
  }

  return undefined;
}

export function handlePiPermCommand(state: any, args = "", ctx: any = {}) {
  const [command, profileName] = String(args).trim().split(/\s+/).filter(Boolean);
  if (!command) {
    notify(ctx, JSON.stringify(summarizePolicy(state), null, 2));
    return summarizePolicy(state);
  }
  if (command === "list") {
    const profiles = Object.keys(state.config.profiles);
    notify(ctx, `Profiles: ${profiles.join(", ")}`);
    return profiles;
  }
  if (command === "use") {
    if (!state.config.profiles[profileName]) {
      const profiles = Object.keys(state.config.profiles);
      notify(ctx, `Unknown profile '${profileName}'. Available: ${profiles.join(", ")}`, "error");
      return { ok: false, profiles };
    }
    state.activeProfile = profileName;
    state.sessionAllows.clear();
    auditEvent(state.config, { type: "profile_switch", profile: profileName }, state.cwd);
    notify(ctx, `pi-perm profile: ${profileName}`);
    return { ok: true, activeProfile: profileName };
  }
  if (command === "audit") {
    const file = state.config.audit?.file ?? "audit.jsonl";
    notify(ctx, `Audit file: ${file}`);
    return { file };
  }
  notify(ctx, "Usage: /pi-perm [list|use <profile>|audit]", "error");
  return { ok: false };
}

async function confirmDecision(ctx: any, config: any, events: any, toolName: string, target: any): Promise<{ action: "deny" | "allow_once" | "allow_session" }> {
  const title = config.prompts?.confirmTitle ?? "Sandbox permission";
  const template = config.prompts?.confirmMessage ?? "Allow {toolName} for {target}?";
  const message = template.replaceAll("{toolName}", toolName).replaceAll("{target}", String(target));
  const restore = setPermissionBlockedStatus(ctx, events, toolName, target);
  try {
    if (ctx.ui?.select) {
      return normalizeConfirmSelection(await ctx.ui.select(`${title}\n${message}`, [
        "Deny",
        "Allow once",
        "Always allow this session"
      ]));
    }
    if (ctx.ui?.prompt) {
      return normalizeConfirmSelection(await ctx.ui.prompt(title, message, {
        choices: [
          { label: "Deny", value: "deny" },
          { label: "Allow once", value: "allow_once" },
          { label: "Always allow this session", value: "allow_session" }
        ]
      }));
    }
    if (!ctx.ui?.confirm) return { action: config.prompts?.noUiAction === "allow" ? "allow_once" : "deny" };
    return { action: await ctx.ui.confirm(title, message) ? "allow_once" : "deny" };
  } finally {
    restore();
  }
}

function createSessionAllowKey(profileName: string, toolName: string, decision: any, target: any) {
  const ruleId = decision.rule?.id ?? decision.operation?.id;
  return [profileName, toolName, ruleId ?? "target", String(target)].join(":");
}

function pruneExpiredSessionAllows(state: any) {
  const ttl = getSessionAllowTtlMs(state);
  if (ttl <= 0) {
    state.sessionAllows.clear();
    return;
  }
  const now = state.now();
  for (const [key, value] of state.sessionAllows.entries()) {
    if (now - value.lastUsedAt > ttl) state.sessionAllows.delete(key);
  }
}

function getSessionAllowTtlMs(state: any) {
  const ttl = state.config.runtime?.sessionAllowTtlMs;
  return typeof ttl === "number" ? ttl : 30 * 60 * 1000;
}

function formatAuditPath(cwd: string, filePath: string) {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : filePath;
}

function setPermissionBlockedStatus(ctx: any, events: any, toolName: string, target: any) {
  const label = `pi-perm permission (${toolName}: ${String(target)})`;
  events?.emit?.("herdr:blocked", { active: true, label });
  ctx.ui?.setStatus?.("pi-perm", "blocked: waiting for permission");
  ctx.ui?.setWorkingMessage?.(`Blocked: waiting for ${label}`);
  ctx.ui?.setWorkingIndicator?.({ frames: ["■"] });
  return () => {
    events?.emit?.("herdr:blocked", { active: false, label });
    ctx.ui?.setStatus?.("pi-perm", undefined);
    ctx.ui?.setWorkingMessage?.();
    ctx.ui?.setWorkingIndicator?.();
  };
}

function normalizeConfirmSelection(selection: any): { action: "deny" | "allow_once" | "allow_session" } {
  const value = typeof selection === "string" ? selection : selection?.value ?? selection?.action ?? selection?.id;
  const normalized = typeof value === "string" ? value.toLowerCase().replaceAll(" ", "_") : value;
  if (normalized === "allow_session" || normalized === "always_allow_this_session" || normalized === "session" || normalized === "always") return { action: "allow_session" };
  if (normalized === "allow_once" || normalized === "allow" || normalized === true) return { action: "allow_once" };
  return { action: "deny" };
}

function notify(ctx: any, message: string, level = "info") {
  ctx.ui?.notify?.(message, level);
}
