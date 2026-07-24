# PiPerm 实现文档

## 1. 概述

pi-perm 是一个 Pi Agent 权限控制 extension package。它通过 Pi extension API 注册生命周期监听、工具调用拦截、命令和只读工具，在 Pi Agent 执行 `bash`、文件读写等工具前，按 TOML/JSON 配置执行确认、阻断、审计和 Sandbox Runtime 包装。

### 1.1 核心职责

| 职责 | 说明 |
|------|------|
| Pi extension 接入 | 在 [index.ts](../index.ts) 默认导出函数中接收 `ExtensionAPI`，注册事件、命令和工具 |
| 配置加载与合并 | 在 [core/config.ts](../core/config.ts) 加载默认配置、项目配置和用户覆盖配置，并生成 effective permission profile |
| 操作权限控制 | 在 [core/policy.ts](../core/policy.ts) 与 [core/operations.ts](../core/operations.ts) 中匹配 permission profile、命令操作、文件路径和工具规则 |
| 沙盒包装 | 在 [core/srt.ts](../core/srt.ts) 生成 SRT settings，并通过 Pi 高版本 `bash` 工具的 `spawnHook` 把实际执行命令包装为 `srt --settings <file> <command>` |
| 用户交互与审计 | 在 [core/extension.ts](../core/extension.ts) 调用 `ctx.ui.confirm/notify` 并通过 [core/audit.ts](../core/audit.ts) 写入审计日志 |

## 2. Pi Extension 工作原理

Pi extension 是一个由 Pi Agent 加载的 TypeScript 模块。模块默认导出一个函数，Pi Agent 会把 `ExtensionAPI` 对象传入该函数。extension 在这个函数里声明自己要参与哪些生命周期、拦截哪些工具调用、暴露哪些命令或工具。

本项目的入口是 [index.ts](../index.ts)：

| 接入点 | 代码位置 | 作用 |
|--------|----------|------|
| 默认导出函数 | [index.ts](../index.ts) | Pi Agent 加载 extension 时执行 |
| `pi.on("session_start")` | [index.ts](../index.ts) | 会话启动时提示当前 active profile |
| `pi.on("tool_call")` | [index.ts](../index.ts) | 每次工具调用前进入权限判定流程 |
| `pi.registerTool("bash")` | [index.ts](../index.ts) | 当当前 Pi Agent 暴露 `createBashToolDefinition` 时注册同名 bash 覆盖工具，用 `spawnHook` 注入 SRT 包装 |
| `pi.registerCommand("pi-perm")` | [index.ts](../index.ts) | 注册 `/pi-perm` 命令，用于查看和切换 profile |
| `pi.registerTool("pi_perm_policy")` | [index.ts](../index.ts) | 注册只读工具，让 agent 查询当前权限摘要 |

Pi extension 的关键能力之一是 `tool_call` hook。Pi Agent 准备执行工具时，会把工具名和入参传给 extension。pi-perm 在该 hook 中只依赖 Pi 支持的阻断/放行语义：

- 返回 `{ block: true, reason }` 阻断工具调用。
- 调用 `ctx.ui.confirm` 请求用户确认。
- 不返回值，让 Pi Agent 继续执行原工具调用。

Pi Agent 0.80.x 的 `tool_call` hook 不会把 extension 对 `event.input` 的修改回写到实际工具入参。因此 pi-perm 不再在 `tool_call` 中改写 bash 命令。SRT 包装迁移到 bash 工具定义的 `spawnHook`：当 `@earendil-works/pi-coding-agent` 导出 `createBashToolDefinition` 时，[index.ts](../index.ts) 注册同名 `bash` 工具覆盖内置定义，并把 [core/extension.ts](../core/extension.ts) 创建的 `spawnHook` 传入。低版本或不暴露该 API 的 Pi Agent 仍保留审批、阻断、确认和审计能力，但启动提示会显示 `bash spawnHook unavailable`，表示无法通过当前 API 注入 SRT 包装。

## 3. 当前项目如何生效

### 3.1 加载方式

当前仓库根目录就是 Pi package 根目录。[package.json](../package.json) 通过 `pi.extensions` 声明 extension 入口：

```json
{
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

因此当用户通过 Pi 的 package 加载方式安装或启用该项目后，Pi Agent 会加载 [index.ts](../index.ts)，执行默认导出函数，并注册 `session_start`、`tool_call`、`/pi-perm`、`pi_perm_policy`；在高版本 Pi Agent 中还会注册同名 `bash` 覆盖工具，用于把实际 spawn 命令接入 `spawnHook`。

### 3.2 配置加载顺序

配置入口在 [core/config.ts](../core/config.ts)。启动时 `createPiPermExtension()` 调用 `loadConfig()`，按以下顺序合并：

| 顺序 | 配置来源 | 说明 |
|------|----------|------|
| 1 | [defaults/base.toml](../defaults/base.toml) | 内置默认 permission profile、工具策略、推荐操作权限 preset |
| 2 | `config.toml`，兼容 `config.json` | 项目级配置，TOML 优先 |
| 3 | `~/.pi/agent/extensions/pi-perm/config.toml`，兼容 JSON | 用户级覆盖配置；可用 `PI_PERM_USER_CONFIG` 指定路径 |

合并后会执行三类处理：

- `normalizePermissionProfiles()`：解析 `activePermissionProfile` 和 `permissions.<name>`，注入内置 profiles，并生成 `effectivePermissionProfiles` / `effectivePermissionProfile`。
- `normalizeConfig()`：把 human-friendly 的 `tools.bash.operations` 展开为底层匹配规则；为 `tools.bash.readOnlyCommands` 兜底为 `[]`。
- `applySecurityBoundary()`：项目配置不能单独开启 Apple Events、弱沙盒、全部 Unix socket、Docker socket 等高风险能力；这些能力必须由用户配置显式授权。

旧 `profiles.<name>.sandbox.*` 权限配置模式不再兼容。加载到旧字段时，系统 fail-closed 并提示迁移到 `permissions.<name>`。

### 3.3 Permission Profile 配置

项目推荐使用 TOML。示例见 [config.example.toml](../config.example.toml)：

```toml
activePermissionProfile = "workspace"

[permissions.workspace.filesystem]
":minimal" = "read"

[permissions.workspace.filesystem.":workspace_roots"]
"." = "write"
".git" = "read"
".codex" = "read"
".agents" = "read"
"**/*.env" = "deny"

[permissions.workspace.network]
enabled = false
allowLocalBinding = false

[tools.bash]
defaultAction = "allow"
wrapWithSrt = true
```

权限值含义：

| 值 | 含义 |
|----|------|
| `read` | 允许读取和列目录，不允许写入 |
| `write` | 允许读取、创建、修改、重命名和删除 |
| `deny` | 拒绝读取和写入，优先级最高 |

路径 scope：

| Scope | 说明 |
|-------|------|
| `:minimal` | 平台和常见工具需要的最小运行时路径 |
| `:workspace_roots` | 当前 workspace roots 下的相对路径，禁止 `..` 逃逸 |
| `:tmpdir` | `$TMPDIR` |
| `:slash_tmp` | `/tmp` |
| `:root` | 文件系统根路径，仅用于明确需要的高权限 profile |

### 3.4 操作权限配置

`tools.bash.operations` 现在是命令级例外规则，不再用于给普通 workspace 内命令配置 allowlist。示例：

```toml
[tools.bash.operations]
preset = "recommended"
block = ["~/.ssh/", "gh auth token", ".git/hooks"]
confirm = ["git push", "rm -r", "curl | sh", "kubectl", "docker"]
```

这段配置会被 [core/operations.ts](../core/operations.ts) 展开：

- `preset = "recommended"` 启用内置推荐风险操作集。
- `block`、`confirm`、`allow` 直接使用用户熟悉的原命令或命令片段。
- `curl | sh` 这类管道写法会被解析为原始命令文本匹配规则。
- `advanced` 可用于项目自定义命令，例如 `pnpm deploy:prod`。

## 4. 调用链路

### 4.1 启动链路

```mermaid
flowchart TD
  A[Pi Agent 加载 package] --> B[读取 package.json pi.extensions]
  B --> C[加载 index.ts 默认导出函数]
  C --> D[createPiPermExtension]
  D --> E[loadConfig]
  E --> F[读取 defaults/base.toml]
  F --> G[读取 config.toml 或 config.json]
  G --> H[读取用户覆盖配置]
  H --> I[deepMerge 合并配置]
  I --> J[normalizePermissionProfiles 生成 effective profiles]
  J --> K[normalizeOperations 展开 preset/原命令模式]
  K --> L[applySecurityBoundary 降级未授权高风险能力]
  L --> M[注册 session_start/tool_call/pi-perm/pi_perm_policy]
  M --> N{Pi Agent 暴露 createBashToolDefinition?}
  N -->|是| O[注册同名 bash 覆盖工具并挂载 spawnHook]
  N -->|否| P[保留审批能力，提示 bash spawnHook unavailable]
```

### 4.2 工具调用权限判定流程

```mermaid
flowchart TD
  A[Pi Agent 准备执行工具] --> B[触发 tool_call hook]
  B --> C[handleToolCall]
  C --> D[获取当前 active permission profile]
  D --> E{工具类型}
  E -->|bash| F[evaluateBashReadAccess 快速通道]
  E -->|read/write/edit| H[evaluateFileAccess]
  E -->|其他| J[evaluateToolCall]
  F --> F1{只读 + cwd 内 + 未命中 deny?}
  F1 -->|是| F2[直接 allow，ruleId=read-only-allowlist]
  F1 -->|否| G[evaluateToolCall]
  H --> H1[按 effective permission profile 判定]
  H1 --> H2{deny/write/read?}
  H2 -->|deny| O
  H2 -->|允许当前访问| F2
  H2 -->|未明确允许| H3[使用 defaultAction]
  G --> K[显式 rules 匹配]
  K --> L{未命中且为 bash?}
  L -->|是| M[parseShellOperations + 匹配 operations + 网络边界]
  L -->|否| N[使用 defaultAction]
  H3 --> Q[得到 allow/block/confirm]
  M --> Q
  N --> Q
  Q -->|block| O[返回 block 阻断工具]
  Q -->|confirm| P[ctx.ui.confirm 请求用户确认]
  P -->|拒绝| O
  P -->|允许| R[放行工具调用]
  N -->|allow| R
  R --> S{bash 覆盖工具 spawnHook 生效且 wrapWithSrt?}
  S -->|是| T[spawn 前生成 extension 数据目录下的 SRT settings]
  T --> V[返回 srt --settings ... 包装后的 spawn command]
  S -->|否| W[使用原工具执行路径]
  O --> U[写审计日志]
  V --> U
  W --> U
```

### 4.3 `/pi-perm` 命令流程

```mermaid
flowchart TD
  A[用户输入 /pi-perm 命令] --> B[handlePiPermCommand]
  B --> C{子命令}
  C -->|空| D[输出当前策略摘要]
  C -->|list| E[列出 permission profiles]
  C -->|use profile| F{permission profile 是否存在}
  F -->|是| G[切换 state.activeProfile]
  F -->|否| H[提示可用 permission profiles]
  C -->|audit| I[输出审计文件路径]
  C -->|其他| J[提示用法]
```

## 5. 业务逻辑详解

### 5.1 会话启动

Pi Agent 触发 `session_start` 后，[index.ts](../index.ts) 通过 `ctx.ui.notify` 显示 `pi-perm loaded: <profile> (...)`，帮助用户确认 extension 已加载。括号内会展示 bash SRT 包装接入状态：`bash spawnHook active` 表示当前 Pi Agent 支持通过覆盖版 bash 工具执行期注入 SRT；`bash spawnHook unavailable` 表示当前 Pi Agent 没有暴露该能力，pi-perm 只能执行审批/阻断，不能保证 `wrapWithSrt` 真正进入 bash 子进程。

### 5.2 工具拦截

每次工具调用都会进入 [core/extension.ts](../core/extension.ts) 的 `handleToolCall()`。核心判断顺序如下：

1. 根据当前 `state.activeProfile` 读取 active permission profile。
2. 文件类工具走 `evaluateFileAccess()`，按 `deny > write > read` 判定路径权限；`write` / `edit` 访问未被当前 permission profile 明确允许且未被 deny 的路径时，会进入确认流程。
3. 其他工具走 `evaluateToolCall()`。
4. `bash` 会先匹配显式 `rules`，再匹配 `operations`，最后按 permission profile 检查网络边界。
5. 结果为 `block` 时直接阻断。
6. 结果为 `confirm` 时先检查当前 session 授权缓存；命中缓存则直接放行并写审计。
7. 未命中缓存时调用 Pi UI 确认，支持“拒绝 / 允许一次 / 本 session 始终允许”。外部文件写入确认会进一步区分“本 session 始终允许当前文件”和“本 session 始终允许当前文件夹”。等待用户输入期间会通过 Pi UI 状态 API 显示 blocked 风格状态，并在存在 Herdr Pi integration 时通过 Pi event bus 发出 `herdr:blocked`；旧环境只有 `ctx.ui.confirm` 时，确认成功只按“允许一次”处理。
8. 如果是 `bash` 且 `wrapWithSrt = true`，只检查 `srtBinary` 是否存在；实际 SRT settings 生成和命令改写发生在覆盖版 bash 工具的 `spawnHook` 中。

### 5.2.1 Session 级授权

[core/extension.ts](../core/extension.ts) 在 extension state 中维护 `sessionAllows` 内存 Map。用户选择“本 session 始终允许”后，系统按当前 active profile、工具名、命中的规则 ID 或操作 ID、目标摘要生成授权 key，并记录最近使用时间。

该授权不会写入 `config.toml`、`config.json` 或用户配置，因此重启 Pi session 后自动失效。每次工具调用前系统会按 `runtime.sessionAllowTtlMs` 清理空闲过期授权；重复命中相同 key 且未过期时，系统跳过确认、刷新最近使用时间并记录 `session_allow_hit` 审计事件。不同 profile、不同命令、不同规则或不同路径仍会重新确认。执行 `/pi-perm use <profile>` 切换 profile 时，系统会清空当前 session 授权缓存。

外部目录写入复用同一套 session 授权机制。`write` 或 `edit` 访问当前 workspace 外部路径且未命中 profile allow/deny 时，会使用 `external-file-write-boundary` 规则请求确认。用户选择“允许一次”只放行当前工具调用；选择“本 session 始终允许当前文件”后，只对相同 active profile、相同工具和相同目标路径摘要复用授权；选择“本 session 始终允许当前文件夹”后，同一文件夹下后续外部 `write/edit` 调用可跳过确认。文件夹级授权不跨文件夹，多目标分布在不同文件夹时不提供文件夹级授权，所有 session 授权都不会写入 permission profile。

确认提示由 `core/extension.ts:confirmDecision()` 统一包裹 UI 状态保护。扩展初始化时会从 `index.ts` 注入 `pi.events`。显示选择器前会调用 `events.emit("herdr:blocked", { active: true, label })`、`ctx.ui.setStatus("pi-perm", "blocked: waiting for permission")`、`ctx.ui.setWorkingMessage(...)` 和 `ctx.ui.setWorkingIndicator({ frames: ["■"] })`；无论用户选择、取消还是 UI 抛错，都会在 `finally` 中发送 `active: false` 并恢复默认状态。缺少 event bus 或 Herdr integration 时不影响权限确认。Herdr 的 `done` 是 `idle + pane 未查看` 的 UI 派生状态，pi-perm 不直接发送 done 事件。

### 5.3 命令操作权限

命令操作权限由 [core/operations.ts](../core/operations.ts) 提供 preset 和原命令模式展开，由 [core/policy.ts](../core/policy.ts) 解析和匹配。它不依赖 Sandbox Runtime，因此即使用户关闭 SRT 包装，也仍可对 `rm`、`git push`、`sudo`、`curl | sh`、`kubectl` 等操作做确认或阻断。普通 workspace 内命令不需要写入 `operations.allow`；只要未命中危险规则且未越过 permission profile 边界，就会自动放行。

常见写法：

| 写法 | 含义 |
|-------|------|
| `rm -r` | 递归删除 |
| `git push` | Git 远程推送 |
| `git reset --hard` | Git 硬重置 |
| `~/.ssh/`、`gh auth token` | 凭据读取 |
| `curl | sh`、`wget | bash` | 远程脚本执行 |
| `scp`、`rsync`、`curl -T` | 网络复制或外传 |
| `pnpm install`、`npm install` | 依赖安装 |
| `docker`、`podman` | 容器运行时操作 |
| `kubectl`、`terraform`、`aws` | 云或集群控制命令 |

### 5.4 SRT 沙盒包装

当 `bash` 策略启用 `wrapWithSrt` 时，[core/extension.ts](../core/extension.ts) 会先解析 pi-perm extension 运行时目录。默认基目录为 `~/.pi/agent/extensions/pi-perm`，`runtime.settingsDir` 只表示该基目录下的相对子目录，默认 `runtime`。绝对 `runtime.settingsDir` 会被配置校验拒绝，避免 SRT settings 回落到项目目录或任意路径。

SRT 包装分为两个阶段：

1. `tool_call` 审批阶段：`handleToolCall()` 根据 permission profile、`rules`、`operations`、网络边界和用户确认结果决定是否放行。若 `wrapWithSrt = true`，该阶段只检查 `srtBinary` 是否存在；不会修改 `event.input.command`，也不会写 SRT settings。
2. bash spawn 阶段：高版本 Pi Agent 暴露 `createBashToolDefinition` 时，[index.ts](../index.ts) 注册同名 `bash` 覆盖工具，并把 `extension.createBashSpawnHook()` 传入 `spawnHook`。Pi 内置 bash 执行前会调用该 hook，hook 根据当前 active effective permission profile 写入 SRT settings，并返回新的 spawn command。

[core/srt.ts](../core/srt.ts) 会把当前 effective permission profile 转换为 SRT settings，写入类似下面的文件：

```text
~/.pi/agent/extensions/pi-perm/runtime/bash-<timestamp>-<counter>.srt-settings.json
```

随后 `spawnHook` 将原始命令包装为：

```bash
srt --settings ~/.pi/agent/extensions/pi-perm/runtime/bash-<timestamp>-<counter>.srt-settings.json <original command>
```

`srt_settings` 审计事件只在 spawnHook 实际生成 settings 后写入，避免 audit 日志和 settings 文件给出“已包裹执行”的误导。这样命令操作审批和 OS 级沙盒会串联生效：先确认/阻断高风险操作，再由 Sandbox Runtime 限制实际进程访问文件、网络和 socket。

低版本或不暴露 `createBashToolDefinition` 的 Pi Agent 无法接入 bash `spawnHook`。这种情况下 `wrapWithSrt` 不会真正改写 bash 子进程命令，pi-perm 仍执行审批/阻断/确认，但不能提供 SRT 执行期沙盒。启动通知中的 `bash spawnHook unavailable` 用于提示该兼容降级状态。

另外，pi-perm 只能保证把 `srt --settings ...` 放入 bash 执行链路，不能保证本机 Sandbox Runtime 一定能启动成功。如果本机 macOS sandbox profile 拒绝 SRT 在 `/tmp/claude/` 下创建 mux Unix socket，`srt` 可能以 `listen EPERM` 失败；这属于 SRT/宿主运行环境限制，不是 `wrapWithSrt` 注入逻辑可以绕过的权限配置问题。

### 5.5 审计文件位置

[core/config.ts](../core/config.ts) 提供 `resolveAuditFile(config, runtimeBaseDir)`，默认写入 `runtime.baseDir/audit.jsonl`。`audit.file` 必须是相对路径；绝对路径（如 `/var/log/audit.jsonl`）和逃出 `runtime.baseDir` 的相对路径（如 `../escape.jsonl`）在配置加载阶段被拒绝，fail-closed 阻断受控工具。

`state.auditFile` 在 `createPiPermExtension()` 中通过 `resolveAuditFile` 解析一次，后续所有 `auditEvent` 调用复用同一个绝对路径，运行时不再解析 cwd。运行时文件不写入当前项目工作目录，仓库保持干净。

## 6. 数据模型

### 6.1 配置模型

| 字段 | 说明 |
|------|------|
| `version` | 配置版本，当前为 `1` |
| `activePermissionProfile` | 默认启用的 permission profile |
| `permissions` | permission profile 集合，每个 profile 包含 filesystem、network 和 dangerous 配置 |
| `profiles` | 可选的人类可见 profile 描述；不再承载 sandbox 权限配置 |
| `tools` | 工具策略，例如 `bash`、`read`、`write`、`edit` |
| `tools.bash.operations` | 命令操作权限，支持 `preset`、`block`、`confirm`、`allow`、`advanced` |
| `prompts` | UI 确认文案和 UI 不可用时的动作 |
| `audit` | 审计开关和日志文件。日志文件路径解析到 `runtime.baseDir` 下，避免写入当前项目目录。 |
| `runtime` | pi-perm 运行时状态配置，包括 `baseDir`、`settingsDir` 和 `sessionAllowTtlMs` |
| `security` | user-only 高风险能力声明 |

### 6.2 审计记录

审计日志由 [core/audit.ts](../core/audit.ts) 写入 JSON Lines，默认文件为 `~/.pi/agent/extensions/pi-perm/audit.jsonl`（见 §5.5）。主要事件包括：

| 事件 | 说明 |
|------|------|
| `decision` | 工具调用的 allow/block/confirm 判定 |
| `confirm` | 用户确认结果 |
| `profile_switch` | `/pi-perm use <profile>` 切换 |
| `srt_settings` | 生成 SRT settings 文件 |
| `downgrade` | 项目配置请求高风险能力但未获用户配置授权 |

## 7. 影响范围

| 范围 | 影响 |
|------|------|
| Pi 工具调用 | 所有经过 `tool_call` hook 的工具会被策略判定 |
| `bash` 命令 | workspace 边界内普通命令自动放行；危险操作、禁网联网命令可确认/阻断；高版本 Pi Agent 支持通过 `spawnHook` 进行 SRT 包装 |
| 文件工具 | `read`、`write`、`edit` 会按 active permission profile 判定 |
| 用户交互 | `confirm` 规则会弹出确认；UI 不可用时默认按配置阻断 |
| 运行时文件 | SRT settings 写入 `~/.pi/agent/extensions/pi-perm/runtime/`；审计日志写入 `~/.pi/agent/extensions/pi-perm/audit.jsonl`，不污染当前项目目录 |
| 外部依赖 | 需要 Pi Agent extension API；SRT 包装需要当前 Pi Agent 暴露 `createBashToolDefinition` / `spawnHook` 能力，且本机存在可正常启动的 `srt` 命令 |

## 8. 验证

当前自动化验证覆盖：

- 配置合并、TOML 优先和原命令模式展开：[test/config.test.ts](../test/config.test.ts)
- 命令操作模式与 preset：[test/operations.test.ts](../test/operations.test.ts)
- 工具规则、文件路径和命令匹配：[test/policy.test.ts](../test/policy.test.ts)
- 外部文件写入确认、文件级 / 文件夹级 session 授权和路径隔离：[test/policy.test.ts](../test/policy.test.ts)、[test/extension.test.ts](../test/extension.test.ts)
- SRT settings 与命令包装：[test/srt.test.ts](../test/srt.test.ts)
- extension 命令和工具调用处理：[test/extension.test.ts](../test/extension.test.ts)
- extension 入口注册高版本 bash 覆盖工具：[test/index.test.ts](../test/index.test.ts)

验证命令：

```bash
pnpm test
pnpm run typecheck
```
