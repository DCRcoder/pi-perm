## Context

当前 pi-perm 使用 `profiles.<name>.sandbox` 描述 SRT 沙盒，并在 `tools.bash.defaultAction = "confirm"` 下通过 `operations` 或显式 rules 决定 bash 行为。该模型安全但摩擦较大：未命中 operations 的普通命令也会确认，用户为了放行常规工作流需要理解 `tools.bash.operations`、`readOnlyCommands`、`allowRead`、`allowWrite` 等多组字段。

Codex 的公开权限模型把问题拆成两层：sandbox 描述技术边界，approval policy 描述何时询问。对本项目而言，本次变更直接把 named permission profiles 设为唯一主配置入口，旧 `profiles.<name>.sandbox.filesystem` 不再作为权限配置来源，避免长期维护两套心智模型。

## Goals / Non-Goals

**Goals:**

- 用一个 `permissions.<name>` profile 表达文件系统和网络边界，降低 TOML 主配置复杂度。
- 默认允许 workspace 边界内的普通 bash 命令，减少确认次数。
- 对危险 bash 操作、文件/网络越界、高风险 socket 或 Apple Events 等能力继续 fail-closed 或确认。
- 明确移除旧 `profiles.<name>.sandbox` 主配置模式，配置错误时 fail-closed 并提示迁移。
- 让 `/pi-perm` 和 `pi_perm_policy` 能展示当前有效 permission profile 摘要。

**Non-Goals:**

- 不实现 Codex 完整 `approval_policy` granular 语法；本次只实现 pi-perm 需要的 `allow`、`confirm`、`block` 判定。
- 不移除 `tools.bash.operations`、`rules` 或现有 profile 命令。
- 不改变 SRT 本身的安全模型或引入新的外部依赖。
- 不默认开启网络访问；联网仍必须显式配置或由用户确认。

## Decisions

### 完整配置样例与字段说明

目标 `config.toml` 以 `permissions` 为唯一权限主入口。下面是推荐的完整项目级配置样例，覆盖 workspace 编辑、网络默认关闭、危险命令例外、审计和运行时目录：

```toml
version = 1

# 当前会话默认使用的权限 profile。该字段替代旧 activeProfile 的权限含义。
activePermissionProfile = "workspace"

# 可选：仅用于展示名称或兼容 /pi-perm use 的用户可见标签。
# 不再允许在 profiles.<name>.sandbox 下配置权限边界。
[profiles.workspace]
description = "Read and edit the workspace, keep network disabled by default."

# 权限 profile：文件系统与网络边界的唯一主配置入口。
[permissions.workspace.filesystem]
# 平台与运行时需要的最小只读路径。普通项目通常保留该项。
":minimal" = "read"

# 对所有 workspace root 生效的相对路径规则。
[permissions.workspace.filesystem.":workspace_roots"]
# workspace 根目录可读写，允许测试、构建、格式化和普通代码编辑自动执行。
"." = "write"

# 保护仓库与 Codex/Pi 本地配置。允许读，避免命令静默修改。
".git" = "read"
".codex" = "read"
".agents" = "read"

# deny 会同时拒绝读写，并优先于更宽的 write。
"**/*.env" = "deny"
".env" = "deny"
".env.*" = "deny"
".git/hooks/**" = "deny"

# 临时目录可按需开启。需要测试工具写临时文件时使用。
[permissions.workspace.filesystem.":tmpdir"]
"." = "write"

[permissions.workspace.filesystem.":slash_tmp"]
"." = "write"

# 网络默认关闭。联网命令会进入确认或阻断，而不是静默执行。
[permissions.workspace.network]
enabled = false
allowLocalBinding = false

# 如果确实需要网络，建议新建 profile，而不是直接扩大 workspace。
[permissions.workspace-network.filesystem]
":minimal" = "read"

[permissions.workspace-network.filesystem.":workspace_roots"]
"." = "write"
"**/*.env" = "deny"
".git" = "read"
".codex" = "read"
".agents" = "read"

[permissions.workspace-network.network]
enabled = true
allowLocalBinding = false

[permissions.workspace-network.network.domains]
"registry.npmjs.org" = "allow"
"api.github.com" = "allow"
"**.example.internal" = "deny"

[permissions.workspace-network.network.unixSockets]
"/var/run/docker.sock" = "deny"

# 高风险能力只能由用户级配置授权；项目级配置请求会被降级。
[permissions.workspace.dangerous]
allowAppleEvents = false
enableWeakerNestedSandbox = false
enableWeakerNetworkIsolation = false
allowAllUnixSockets = false

[tools.bash]
mode = "enforce"
defaultAction = "allow"
wrapWithSrt = true
srtBinary = "srt"

# operations 是高级例外规则：只描述需要覆盖边界默认行为的命令。
[tools.bash.operations]
preset = "recommended"
block = ["~/.ssh/", "gh auth token", ".git/hooks"]
confirm = [
  "git push",
  "git commit",
  "git reset --hard",
  "git clean",
  "rm -r",
  "sudo",
  "curl | sh",
  "wget | bash",
  "scp",
  "rsync",
  "npm publish",
  "pnpm publish",
  "docker",
  "kubectl",
  "terraform",
  "aws",
  "gcloud",
  "az",
  "open",
  "osascript"
]

[tools.read]
mode = "enforce"
defaultAction = "confirm"
pathFields = ["path"]

[tools.write]
mode = "enforce"
defaultAction = "confirm"
pathFields = ["path", "file_path"]

[tools.edit]
mode = "enforce"
defaultAction = "confirm"
pathFields = ["path", "file_path"]

[prompts]
noUiAction = "block"
confirmTitle = "Sandbox permission"
confirmMessage = "Allow {toolName} for {target}?"

[audit]
enabled = true
file = "audit.jsonl"

[runtime]
baseDir = "~/.pi/agent/extensions/pi-perm"
settingsDir = "runtime"
sessionAllowTtlMs = 1800000
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `version` | 是 | 配置版本，当前为 `1` |
| `activePermissionProfile` | 是 | 当前默认权限 profile 名称，指向 `permissions.<name>` 或内置 profile |
| `profiles.<name>.description` | 否 | 用户可见说明；不得再包含 `sandbox` 权限配置 |
| `permissions.<name>.filesystem` | 是 | 文件系统权限规则集合 |
| `permissions.<name>.filesystem.":workspace_roots"` | 常用 | 对当前 workspace root 和未来扩展 workspace root 生效的相对路径规则 |
| `permissions.<name>.network.enabled` | 是 | 是否允许 bash/SRT 网络访问 |
| `permissions.<name>.network.domains` | 否 | 域名 allow/deny 规则；deny 优先 |
| `permissions.<name>.network.unixSockets` | 否 | Unix socket allow/deny 规则；Docker socket 默认应 deny |
| `permissions.<name>.dangerous` | 否 | Apple Events、弱隔离、全 Unix socket 等高风险开关，项目级配置不能单独提升 |
| `tools.bash.defaultAction` | 是 | 未命中危险规则且在权限边界内时的默认动作，推荐 `allow` |
| `tools.bash.operations` | 否 | 高级命令例外规则，用于 block/confirm/allow 特定命令模式 |
| `tools.read/write/edit` | 是 | 文件工具入口配置；最终是否放行由 permission profile 决定 |
| `audit` | 是 | 审计开关和审计文件相对路径 |
| `runtime` | 是 | extension 运行时目录、SRT settings 目录和 session 授权 TTL |

文件系统 scope 说明：

| Scope | 用途 | 子路径 |
|-------|------|--------|
| `:minimal` | 平台和常见工具需要的最小只读运行时路径 | 仅 `"."` |
| `:workspace_roots` | 当前 workspace roots，以及未来显式加入的 workspace roots | 支持相对子路径，禁止 `..` 逃逸 |
| `:tmpdir` | `$TMPDIR` | 仅 `"."` |
| `:slash_tmp` | `/tmp` | 仅 `"."` |
| `:root` | 整个文件系统根路径 | 仅在审计/只读扫描 profile 中使用 |
| 绝对路径或 `~/path` | 明确的机器本地路径 | 支持子路径 |

权限值说明：

| Access | 含义 |
|--------|------|
| `read` | 允许读取和列目录，不允许创建、修改、删除 |
| `write` | 允许读取和写入，包括创建、修改、重命名和删除 |
| `deny` | 拒绝读取和写入；同一路径冲突时优先级最高 |

优先级规则：

1. 更具体路径优先于更宽路径。
2. 同一路径或同等具体度下，`deny > write > read`。
3. `:workspace_roots` 子路径必须保持在 workspace 内，`../` 逃逸直接配置错误。
4. 项目级配置不能通过 `dangerous` 开启高风险能力；必须由用户级配置显式授权。

旧配置迁移对照：

| 旧字段 | 新写法 |
|--------|--------|
| `activeProfile = "workspace"` | `activePermissionProfile = "workspace"` |
| `[profiles.workspace.sandbox.filesystem] allowRead = ["."]` | `[permissions.workspace.filesystem.":workspace_roots"] "." = "read"` |
| `[profiles.workspace.sandbox.filesystem] allowWrite = ["."]` | `[permissions.workspace.filesystem.":workspace_roots"] "." = "write"` |
| `[profiles.workspace.sandbox.filesystem] denyRead = ["**/*.env"]` | `[permissions.workspace.filesystem.":workspace_roots"] "**/*.env" = "deny"` |
| `[profiles.workspace.sandbox.filesystem] denyWrite = [".git/hooks/**"]` | `[permissions.workspace.filesystem.":workspace_roots"] ".git/hooks/**" = "deny"` |
| `[profiles.workspace.sandbox.network] allowedDomains = ["api.github.com"]` | `[permissions.workspace.network.domains] "api.github.com" = "allow"` |
| `[profiles.workspace.sandbox.network] deniedDomains = ["ads.example.com"]` | `[permissions.workspace.network.domains] "ads.example.com" = "deny"` |
| `[profiles.workspace.sandbox.network] allowUnixSockets = ["/var/run/docker.sock"]` | `[permissions.workspace.network.unixSockets] "/var/run/docker.sock" = "allow"` |
| `[profiles.workspace.sandbox] allowAppleEvents = true` | `[permissions.workspace.dangerous] allowAppleEvents = true`，且只能由用户级配置授权 |

旧 `profiles.<name>.sandbox.*` 字段不再兼容。加载到这些字段时系统必须 fail-closed，并提示按上表迁移。

### Decision 1: 新增 `permissions` 为唯一主配置，旧 `profiles.*.sandbox` 不再兼容

新增配置形态：

```toml
activePermissionProfile = "workspace"

[permissions.workspace.filesystem]
":minimal" = "read"

[permissions.workspace.filesystem.":workspace_roots"]
"." = "write"
".git" = "read"
".codex" = "read"
"**/*.env" = "deny"

[permissions.workspace.network]
enabled = false
```

内部新增有效模型 `EffectivePermissionProfile`：

| 字段 | 类型 | 含义 |
|------|------|------|
| `name` | `string` | 当前 permission profile 名称 |
| `filesystem.entries` | `PermissionFsEntry[]` | 归一化后的路径权限条目 |
| `network.enabled` | `boolean` | bash/SRT 是否允许网络 |
| `network.domains` | `Record<string, "allow" \| "deny">` | 域名规则，deny 优先 |
| `network.unixSockets` | `Record<string, "allow" \| "deny">` | Unix socket 规则 |
| `network.allowLocalBinding` | `boolean` | 是否允许本地/私有地址 |
| `dangerous` | `object` | Apple Events、弱沙盒、全 Unix socket 等高风险开关 |

`PermissionFsEntry` 字段：

| 字段 | 类型 | 含义 |
|------|------|------|
| `scope` | `":root" \| ":minimal" \| ":workspace_roots" \| ":tmpdir" \| ":slash_tmp" \| "path"` | 路径来源 |
| `path` | `string` | scope 下的相对路径或绝对路径 |
| `access` | `"read" \| "write" \| "deny"` | 权限 |
| `specificity` | `number` | precedence 排序使用 |
| `source` | `"permissions" \| "builtin"` | 配置来源 |

迁移策略：

- 配置必须声明 `permissions`，或显式选择内置 profile。
- 如果配置仍声明旧 `profiles.<name>.sandbox.filesystem.allowRead/allowWrite/denyRead/denyWrite` 作为主权限来源，加载阶段报错并提示迁移到 `permissions.<name>.filesystem`。
- `profiles` 仅保留为历史命令/profile 名称入口时的薄映射，不再承载 sandbox 权限字段；若实现时发现已经没有必要保留，可同步移除 `/pi-perm use <profile>` 对旧 profile 表的依赖，改为切换 permission profile。
- `deny` 比 `write` 优先，`write` 比 `read` 优先；更具体路径覆盖更宽路径。
- 项目配置仍不能单独启用高风险能力，继续经过 `applySecurityBoundary()` 降级。

替代方案：保留旧配置兼容并转换为 effective permission profile。放弃原因是用户明确要求彻底变更旧配置模式，继续兼容会保留两套心智模型，不能解决 TOML 理解负担。

### Decision 2: bash 默认使用边界内 allow，危险操作和越界才确认

新的 bash 决策顺序：

1. 读取工具策略和当前有效 permission profile。
2. 显式 `rules` 命中 `block` 时直接阻断；命中 `confirm` 时确认；命中 `allow` 时继续检查沙盒边界。
3. `tools.bash.operations` 命中时按 operation action 处理；危险 preset 中的 `block`/`confirm` 仍优先于默认放行。
4. 对命令做轻量静态分析：
   - 若包含明确网络命令或包安装/发布/云控制命令，且 network 未启用或未命中 allow domain，返回 `confirm` 或 `block`。
   - 若包含重定向、删除、移动、写入类命令，提取可识别路径并按 filesystem entries 判定。
   - 无法可靠识别但属于危险命令类别时使用 operations preset 兜底。
5. 如果未命中危险规则且未发现越界行为，返回 `allow`，再按 `wrapWithSrt` 生成 SRT settings 执行。

默认配置变化：

| 字段 | 当前 | 变更后 |
|------|------|--------|
| `tools.bash.defaultAction` | `confirm` | `allow` |
| `profiles.workspace.toolDefaults.defaultAction` | `confirm` | 文件写入类仍可为 `confirm`，bash 由自身策略控制 |
| `tools.write.defaultAction` / `tools.edit.defaultAction` | `confirm` | workspace 可写路径内 `allow`，deny 路径 `block`，边界外 `confirm` |

替代方案：继续扩展 `readOnlyCommands` allowlist。放弃原因是只能解决读取命令，不能处理测试、构建、格式化等普通写入工作流，也会让命令 allowlist 继续膨胀。

### Decision 3: 配置样例偏向 profile 选择，advanced 放到后半段

`config.example.toml` 主体展示：

```toml
activePermissionProfile = "workspace"

[permissions.workspace.filesystem.":workspace_roots"]
"." = "write"
"**/*.env" = "deny"
".git" = "read"
".codex" = "read"

[permissions.workspace.network]
enabled = false

[tools.bash]
wrapWithSrt = true
defaultAction = "allow"
```

高级 operations 示例保留，但文案明确其用途是“例外规则”，不是常规放行的必要配置。

替代方案：只在 README 解释旧配置。放弃原因是用户主要复制 `config.example.toml`，示例必须承载新的低负担路径。

## Core Flow

配置加载流程：

1. `loadConfig()` 按默认、项目、用户顺序合并。
2. `normalizeConfig()` 调用 `normalizePermissionProfiles(config)`：
   - 注入内置 profile。
   - 解析 `permissions`。
   - 解析 `activePermissionProfile`，缺省映射到 `activeProfile` 或 `workspace`。
3. `validateConfig()` 校验 path scope、access 值、network domains、禁止 workspace 子路径逃逸，并拒绝旧 sandbox 权限字段作为主配置。
4. `applySecurityBoundary()` 对新旧高风险字段统一降级。

工具调用流程：

1. `handleToolCall()` 获取 active profile 和 effective permission profile。
2. 文件工具调用 `evaluateFileAccess()`，按有效 filesystem entries 判定。
3. bash 调用先走 rules/operations，再用 `evaluateBashBoundary()` 判定网络和文件边界。
4. 决策为 `confirm` 时复用现有 session 授权；决策为 `allow` 时直接执行并审计。
5. 需要 SRT 时从 effective permission profile 生成 settings。

## Risks / Trade-offs

- [Risk] bash 静态路径分析无法完全理解 shell 语法 -> Mitigation: 危险类别继续由 operations preset 兜底，无法可靠识别的高风险命令仍确认，最终由 SRT 执行期边界兜底。
- [Risk] 默认 `bash.defaultAction = "allow"` 可能让用户误以为完全无保护 -> Mitigation: 文档明确 allow 表示“沙盒边界内自动执行”，越界和危险操作仍会确认或阻断。
- [Risk] 旧用户配置升级后无法加载 -> Mitigation: fail-closed 错误信息必须包含旧字段到新 `permissions` 字段的迁移提示，README 和示例同步更新。
- [Risk] SRT settings 与新权限模型字段不完全一致 -> Mitigation: 将转换集中在一个 helper，测试覆盖新旧配置生成相同 SRT 行为。

## Migration Plan

1. 实现新模型解析、校验和旧配置拒绝逻辑。
2. 加入 policy 判定测试后，将默认配置直接改为 `permissions.workspace` 和 `bash.defaultAction = "allow"`。
3. 更新 `config.example.toml` 和 README，给出旧字段到新字段的迁移映射。
4. 如发现回归，可回滚默认配置，但不恢复旧配置兼容转换。

## Open Questions

无。本次确认采用 Codex 风格 named permission profiles 作为主配置入口，operations 保留为高级例外规则。
