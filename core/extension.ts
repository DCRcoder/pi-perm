import path from "node:path";
import { loadConfig, getActiveProfile } from "./config.ts";
import { auditEvent } from "./audit.ts";
import { evaluateFileAccess, evaluateToolCall, summarizePolicy } from "./policy.ts";
import { commandExists, wrapCommandWithSrt, writeSrtSettings } from "./srt.ts";

export function createPiPermExtension(options: any = {}) {
  const loaded = loadConfig(options);
  const state = {
    config: loaded.config,
    activeProfile: loaded.config.activeProfile,
    cwd: options.cwd ?? process.cwd(),
    commandExists: options.commandExists ?? commandExists
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
    const ok = await confirmDecision(ctx, state.config, toolName, decision.target ?? input.command ?? toolName);
    auditEvent(state.config, { type: "confirm", toolName, allowed: ok, target: decision.target ?? input.command }, state.cwd);
    if (!ok) return { block: true, reason: `Denied by user: ${toolName}` };
  }

  if (toolName === "bash" && decision.policy.wrapWithSrt) {
    if (!state.commandExists(decision.policy.srtBinary ?? "srt")) {
      const reason = `srt binary not found: ${decision.policy.srtBinary ?? "srt"}`;
      auditEvent(state.config, { type: "block", toolName, reason }, state.cwd);
      ctx.ui?.notify?.(reason, "error");
      return { block: true, reason };
    }
    const runtimeDir = state.config.runtime?.settingsDir ?? "runtime";
    const settingsPath = writeSrtSettings({ profile, cwd: state.cwd, runtimeDir, toolCallId: event.toolCallId ?? "bash" });
    event.input.command = wrapCommandWithSrt(input.command, settingsPath, decision.policy.srtBinary ?? "srt");
    auditEvent(state.config, { type: "srt_settings", toolName, settingsPath: path.relative(state.cwd, settingsPath) }, state.cwd);
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

async function confirmDecision(ctx: any, config: any, toolName: string, target: any) {
  if (!ctx.ui?.confirm) return config.prompts?.noUiAction === "allow";
  const title = config.prompts?.confirmTitle ?? "Sandbox permission";
  const template = config.prompts?.confirmMessage ?? "Allow {toolName} for {target}?";
  const message = template.replaceAll("{toolName}", toolName).replaceAll("{target}", String(target));
  return ctx.ui.confirm(title, message);
}

function notify(ctx: any, message: string, level = "info") {
  ctx.ui?.notify?.(message, level);
}
