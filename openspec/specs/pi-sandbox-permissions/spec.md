# pi-sandbox-permissions Specification

## Purpose
TBD - created by archiving change add-pi-sandbox-permissions-extension. Update Purpose after archive.
## Requirements
### Requirement: 配置化权限控制
系统 SHALL 通过配置文件定义工具拦截、permission profile、命令操作权限、文件系统、网络、Unix socket、提示、审计和 SRT 包装行为。permission profile SHALL 是文件系统和网络权限的唯一主配置入口。除 schema、安全兜底、内置权限 profile 和加载路径外，代码 MUST NOT 硬编码具体业务路径、网络域名、命令白名单或用户项目 profile 行为。

#### Scenario: TOML 配置优先
- **WHEN** package 根目录同时存在 `config.toml` 和 `config.json`
- **THEN** 系统优先读取 `config.toml`，并保留 `config.json` 作为兼容格式

#### Scenario: 从配置加载控制规则
- **WHEN** extension 启动并存在默认配置、项目配置和用户配置
- **THEN** 系统按定义顺序合并配置，并使用合并后的 active permission profile 和 active profile 处理工具调用

#### Scenario: 旧 profile sandbox 主配置不再兼容
- **WHEN** extension 启动时配置仍使用旧 `profiles.<name>.sandbox.filesystem` 作为权限主配置
- **THEN** 系统报告配置错误并阻断受控工具
- **AND** 系统不得静默转换旧配置

#### Scenario: 禁止代码硬编码用户策略
- **WHEN** 需要调整允许写入路径、允许访问域名、工具默认动作或高风险命令例外
- **THEN** 用户只需修改配置文件，系统不要求修改 TypeScript 代码

#### Scenario: 仓库根目录作为 Pi package 根目录
- **WHEN** 系统读取项目级配置、加载 extension 入口或生成运行时 SRT settings
- **THEN** 系统使用仓库根目录的 `package.json`、`index.ts`、`config.toml` 或 `config.json` 处理 package 与项目配置
- **AND** 系统使用 pi-perm extension 数据目录生成运行时 SRT settings，不要求本仓库源码放在 `.pi/extensions/pi-perm/` 下

### Requirement: 配置安全边界
系统 SHALL 区分项目配置和用户配置。项目配置 MUST NOT 单独启用高风险能力，包括 Apple Events、弱嵌套沙盒、弱网络隔离、允许所有 Unix socket 或高风险 socket。

#### Scenario: 项目配置请求高风险能力
- **WHEN** 项目配置启用高风险能力但用户配置未显式允许
- **THEN** 系统拒绝该提升、保持安全默认行为，并写入审计记录

#### Scenario: 用户配置允许高风险能力
- **WHEN** 用户配置显式允许某个高风险能力
- **THEN** 系统可以将该能力纳入生成的 SRT settings，并在策略摘要中标记为用户授权

### Requirement: Bash 工具沙盒包装
系统 SHALL 在配置启用时拦截 Pi 的 `bash` 工具调用，基于当前 profile 生成 SRT settings，并将命令包装为通过 `srt --settings <file>` 执行。

#### Scenario: Bash 调用启用 SRT
- **WHEN** `bash` 工具调用发生且当前工具策略 `wrapWithSrt` 为 true
- **THEN** 系统生成临时 SRT settings 文件，并修改 `event.input.command` 以通过配置的 `srtBinary` 执行原命令

#### Scenario: SRT 不可用
- **WHEN** `bash` 工具调用需要 SRT 包装但系统找不到 `srt` 命令
- **THEN** 系统阻断该工具调用，并向用户显示安装或配置 `srtBinary` 的错误信息

### Requirement: 命令操作权限审批
系统 SHALL 在执行 `bash` 工具前按有效 permission profile 和配置化命令操作规则进行允许、确认或阻断。该能力 MUST NOT 依赖 sandbox-runtime 的执行结果，必须能在执行前覆盖删除、权限修改、Git 写入、提权、远程脚本执行、凭据访问、网络外传、依赖安装、制品发布、容器、云资源和系统自动化等风险操作。

#### Scenario: 命令操作规则来自配置
- **WHEN** 用户在配置中新增或修改 `tools.bash.operations` 规则
- **THEN** 系统按该配置决定命令操作的 `allow`、`block` 或 `confirm` 动作，不要求修改代码

#### Scenario: 配置样例和字段说明可用
- **WHEN** 用户查看项目文档或配置示例
- **THEN** 系统提供 TOML 样例和字段说明，包括 `preset`、`block`、`confirm`、`allow`、常用原命令模式，以及 `advanced` 中的 `id`、`category`、`command`、`subcommands`、`argvIncludes`、`commandIncludes`、`commandIncludesAll`、`action` 和 `reason`
- **AND** 文档说明 operations 是高级例外规则，不是普通 bash 自动放行的必要条件

#### Scenario: 使用原命令模式配置操作权限
- **WHEN** 用户在 `tools.bash.operations.confirm` 中配置 `git push` 或 `curl | sh`
- **THEN** 系统展开原命令模式并对对应命令操作执行确认，不要求用户书写底层 matcher

#### Scenario: 普通项目命令不需要 operations allowlist
- **WHEN** `bash` 命令在当前 permission profile 边界内执行且未命中高风险 operations
- **THEN** 系统按边界内默认放行处理
- **AND** 用户不需要在 `tools.bash.operations.allow` 中列出该命令

#### Scenario: 删除操作需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的 `rm` 删除操作
- **THEN** 系统在执行前通过 `ctx.ui.confirm` 请求用户确认，并根据用户选择允许或阻断该调用

#### Scenario: Git 远程写入需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的 `git push` 操作
- **THEN** 系统在执行前请求用户确认，并记录确认结果

#### Scenario: Git 破坏性工作区操作需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的 `git reset --hard` 或 `git clean` 操作
- **THEN** 系统在执行前请求用户确认，并根据用户选择允许或阻断该调用

#### Scenario: 提权命令需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的 `sudo` 操作
- **THEN** 系统在执行前请求用户确认，并记录该操作命中的规则 ID

#### Scenario: 配置可阻断特定操作
- **WHEN** 配置将某个命令操作规则设置为 `block`
- **THEN** 系统不请求用户确认，直接阻断该工具调用并返回配置化原因

#### Scenario: 远程脚本执行链需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的 `curl ... | sh`、`wget ... | bash`、进程替换或 `eval` 操作
- **THEN** 系统在执行前请求用户确认，并记录命中的远程脚本执行规则

#### Scenario: 凭据访问可被阻断
- **WHEN** `bash` 工具调用包含配置为 `block` 的凭据读取操作，例如读取 SSH key、调用系统钥匙串或输出 CLI auth token
- **THEN** 系统直接阻断该工具调用，并记录命中的凭据访问规则

#### Scenario: 网络外传需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的 `scp`、`rsync`、`sftp`、`nc`、上传式 `curl` 或云存储复制操作
- **THEN** 系统在执行前请求用户确认，并记录外传目标摘要

#### Scenario: 发布操作需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的包发布、镜像推送或 release 创建操作
- **THEN** 系统在执行前请求用户确认，并记录命中的发布规则

#### Scenario: 云和集群控制需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的 `kubectl`、`terraform`、`aws`、`gcloud` 或 `az` 资源变更操作
- **THEN** 系统在执行前请求用户确认，并记录命中的基础设施操作规则

#### Scenario: 系统自动化需要确认
- **WHEN** `bash` 工具调用包含配置为 `confirm` 的 `open`、`osascript`、`launchctl` 或系统自动化操作
- **THEN** 系统在执行前请求用户确认，并记录命中的系统自动化规则

### Requirement: Session 级确认授权
系统 SHALL 在确认提示中支持“允许一次”和 session 级授权。session 级授权 MUST 只在当前 extension 实例生命周期内生效，MUST NOT 写入配置或跨 session 持久化。session 级授权 SHALL 按 active profile、工具名、规则 ID 或操作 ID、授权范围和目标摘要限制复用范围。对于结构化文件工具的外部写入确认，系统 SHALL 支持文件级 session 授权和文件夹级 session 授权。

#### Scenario: 用户选择允许一次
- **WHEN** 工具调用命中 `confirm` 规则且用户选择“允许一次”
- **THEN** 系统放行当前调用，不写入 session 授权缓存，并在下一次命中同一规则和目标时再次请求确认

#### Scenario: 用户选择本 session 始终允许
- **WHEN** 非外部文件写入工具调用命中 `confirm` 规则且用户选择“本 session 始终允许”
- **THEN** 系统放行当前调用，并按 active profile、`toolName`、规则 ID 或操作 ID、目标摘要记录当前 session 授权 key

#### Scenario: 用户选择文件级 session 授权
- **WHEN** 工具调用命中 `confirm` 规则且用户选择“本 session 始终允许当前文件”
- **THEN** 系统放行当前调用，并按 active profile、`toolName`、规则 ID 或操作 ID、文件级授权范围和目标摘要记录当前 session 授权 key

#### Scenario: 用户选择文件夹级 session 授权
- **WHEN** `write` 或 `edit` 工具命中外部写入确认规则且用户选择“本 session 始终允许当前文件夹”
- **THEN** 系统放行当前调用，并按 active profile、`toolName`、规则 ID、文件夹级授权范围和目标所在文件夹摘要记录当前 session 授权 key

#### Scenario: 同一 session 内重复命中已授权目标
- **WHEN** 后续工具调用命中相同的 session 授权 key
- **THEN** 系统不再请求用户确认，直接放行该调用，并记录 session 授权命中审计

#### Scenario: 不同命令或路径仍需确认
- **WHEN** 用户已对一个命令或路径选择“本 session 始终允许”
- **THEN** 系统不得将该授权用于不同规则 ID、不同操作 ID 或不同目标摘要的工具调用

#### Scenario: 外部写入文件级授权不扩大到其他路径
- **WHEN** 用户对一个外部 `write` 或 `edit` 目标选择“本 session 始终允许当前文件”
- **THEN** 系统只对相同 active profile、相同工具、相同外部目标摘要复用授权
- **AND** 系统不得将该授权用于其他外部文件、目录或不同目标组合

#### Scenario: 外部写入文件夹级授权复用同一文件夹
- **WHEN** 用户对一个外部 `write` 或 `edit` 目标选择“本 session 始终允许当前文件夹”
- **AND** 后续 `write` 或 `edit` 工具访问同一文件夹下另一个未被当前 permission profile 明确允许且未被 deny 的路径
- **THEN** 系统不再请求用户确认，直接放行该调用
- **AND** 系统记录文件夹级 session 授权命中审计

#### Scenario: 外部写入文件夹级授权不跨文件夹
- **WHEN** 用户已对一个外部文件夹选择“本 session 始终允许当前文件夹”
- **AND** 后续 `write` 或 `edit` 工具访问另一个文件夹下的外部路径
- **THEN** 系统不得复用原文件夹授权，必须重新请求确认

#### Scenario: 切换 profile 后授权失效
- **WHEN** 用户已对一个工具调用选择“本 session 始终允许”后执行 `/pi-perm use <profile>` 切换到另一个 profile
- **THEN** 系统清空当前 session 授权缓存，后续同名工具、规则和目标仍需重新确认

#### Scenario: UI 只支持布尔确认
- **WHEN** 运行环境只提供 `ctx.ui.confirm` 而不支持选项式确认
- **THEN** 系统保持兼容，用户确认成功只视为“允许一次”，不得写入 session 授权缓存

### Requirement: 文件工具权限判定
系统 SHALL 在配置启用时拦截文件类工具，并根据当前 effective permission profile 的路径规则决定允许、阻断或确认。对于 `write` 和 `edit` 工具，未被当前 permission profile 明确允许且未被 deny 的路径 SHALL 触发用户确认，即使工具默认动作配置为 `allow`。

#### Scenario: 写入允许路径
- **WHEN** `write` 或 `edit` 工具访问当前 permission profile 中 `write` 允许的 workspace 路径
- **THEN** 系统允许该工具调用
- **AND** 系统不得为普通 workspace 写入请求确认

#### Scenario: 写入被拒绝路径
- **WHEN** `write` 或 `edit` 工具尝试访问配置中拒绝的路径
- **THEN** 系统在工具执行前阻断调用，并返回配置化的拒绝原因

#### Scenario: 读取只读路径
- **WHEN** `read` 工具访问当前 permission profile 中 `read` 允许但未允许写入的路径
- **THEN** 系统允许读取
- **AND** 写入同一路径仍不得自动允许

#### Scenario: 需要用户确认的边界外路径
- **WHEN** 文件工具访问未被当前 permission profile 明确允许且未被 deny 的路径
- **THEN** 系统通过 `ctx.ui.confirm` 请求用户确认，并根据用户选择允许或阻断该次调用

#### Scenario: 外部写入路径需要用户确认
- **WHEN** `write` 或 `edit` 工具访问当前 workspace 外部路径，且该路径未被当前 permission profile 明确允许或 deny
- **THEN** 系统在工具执行前请求用户确认
- **AND** 用户可以选择拒绝、允许一次、本 session 始终允许当前文件或本 session 始终允许当前文件夹

#### Scenario: 外部写入确认不受工具默认 allow 影响
- **WHEN** `tools.write.defaultAction` 或 `tools.edit.defaultAction` 配置为 `allow`
- **AND** `write` 或 `edit` 工具访问未被当前 permission profile 明确允许且未被 deny 的外部路径
- **THEN** 系统仍然请求用户确认，不得因工具默认 allow 自动放行

#### Scenario: Deny 优先于外部写入确认
- **WHEN** `write` 或 `edit` 工具访问命中当前 permission profile `deny` 规则的路径
- **THEN** 系统直接阻断该工具调用
- **AND** 系统不得显示允许一次或本 session 始终允许的确认选项

### Requirement: Profile 管理命令
系统 SHALL 提供 `/pi-perm` 命令，用于查看当前策略摘要、列出配置中的 profile、切换到已存在 profile 和查看审计信息。

#### Scenario: 查看当前策略
- **WHEN** 用户执行 `/pi-perm`
- **THEN** 系统显示当前 active profile、受控工具、文件系统摘要、网络摘要和高风险授权摘要

#### Scenario: 切换已存在 profile
- **WHEN** 用户执行 `/pi-perm use <profile>` 且 profile 存在于配置中
- **THEN** 系统切换当前 session 的 active profile，并通知用户切换结果

#### Scenario: 切换不存在 profile
- **WHEN** 用户执行 `/pi-perm use <profile>` 但 profile 不存在
- **THEN** 系统保持当前 profile 不变，并显示可用 profile 列表

### Requirement: Agent 可查询但不可提升权限
系统 SHALL 注册 `pi_perm_policy` 工具，让 agent 查询当前策略摘要。该工具 MUST NOT 修改配置、切换 profile 或提升权限。

#### Scenario: Agent 查询策略
- **WHEN** agent 调用 `pi_perm_policy`
- **THEN** 系统返回当前 profile、受控工具和权限摘要

#### Scenario: Agent 请求提升权限
- **WHEN** agent 通过 `pi_perm_policy` 参数或内容请求修改配置或启用更宽权限
- **THEN** 系统不执行任何权限变更，并返回只读工具说明

### Requirement: 审计记录
系统 SHALL 按配置记录权限判定、用户确认结果、策略降级、SRT settings 生成和阻断原因。审计文件 MUST 写入 pi-perm extension 数据目录（`runtime.baseDir`）下，不得在当前项目目录创建任何审计文件。

#### Scenario: 工具调用被阻断
- **WHEN** 任一受控工具调用被策略阻断
- **THEN** 系统记录工具名、规则 ID、动作、原因和时间

#### Scenario: 命令操作命中规则
- **WHEN** `bash` 调用命中命令操作权限规则
- **THEN** 系统记录命令操作、规则 ID、动作、原因和时间

#### Scenario: 用户确认授权
- **WHEN** 用户通过确认提示允许一次或 session 级调用
- **THEN** 系统记录授权范围、来源和过期条件

#### Scenario: Session 授权命中
- **WHEN** 工具调用因当前 session 授权缓存而跳过确认
- **THEN** 系统记录命中的授权 key、工具名、目标摘要和时间

#### Scenario: 审计文件位于 extension 数据目录
- **WHEN** `audit.enabled = true` 且未指定 `audit.file`
- **THEN** 系统把审计文件写入 `runtime.baseDir/audit.jsonl`，不创建项目目录的 `audit.jsonl`

#### Scenario: 审计文件路径来自配置
- **WHEN** 用户设置 `audit.file = "logs/perm.jsonl"`
- **THEN** 系统把审计文件写入 `runtime.baseDir/logs/perm.jsonl`，自动创建父目录

#### Scenario: 拒绝绝对 audit.file
- **WHEN** 用户设置 `audit.file = "/var/log/audit.jsonl"`
- **THEN** 加载阶段抛出错误，fail-closed 阻断受控工具

#### Scenario: 拒绝逃出 runtime.baseDir 的 audit.file
- **WHEN** 用户设置 `audit.file = "../escape.jsonl"`
- **THEN** 加载阶段抛出错误，fail-closed 阻断受控工具

#### Scenario: 禁用 audit
- **WHEN** `audit.enabled = false`
- **THEN** 系统不创建任何审计文件

### Requirement: Fail-closed 行为
系统 SHALL 在配置错误、SRT 缺失、UI 不可用或平台不支持且没有显式降级配置时，对受控工具采用 fail-closed 行为。

#### Scenario: 配置无法解析
- **WHEN** extension 无法解析或校验配置
- **THEN** 系统阻断配置声明的受控工具，并显示配置错误位置

#### Scenario: UI 不可用
- **WHEN** 规则动作需要用户确认但 `ctx.ui` 不可用
- **THEN** 系统按配置的 `noUiAction` 处理，默认阻断调用

### Requirement: Extension 运行时状态目录
系统 SHALL 将 pi-perm 运行时状态写入 pi-perm extension 数据目录，MUST NOT 默认或通过相对 `runtime.settingsDir` 在当前项目目录创建 `runtime/`。

#### Scenario: 默认 SRT settings 不写入项目目录
- **WHEN** `bash` 工具调用启用 SRT 包装且用户未覆盖运行时目录
- **THEN** 系统将 SRT settings 写入 `~/.pi/agent/extensions/pi-perm/runtime`
- **AND** 系统不得在当前项目目录创建或写入 `runtime/`

#### Scenario: 相对 settingsDir 解析到 extension 数据目录
- **WHEN** 配置设置 `runtime.settingsDir = "runtime"` 或其他相对子目录
- **THEN** 系统将该目录解析为 `runtime.baseDir` 下的子目录
- **AND** 系统不得以当前项目目录为基准解析该路径

#### Scenario: 拒绝绝对 settingsDir
- **WHEN** 配置设置绝对路径形式的 `runtime.settingsDir`
- **THEN** 系统报告配置错误并阻断受控工具
- **AND** 用户需要通过 `runtime.baseDir` 配置运行时基目录

#### Scenario: 拒绝逃出 runtime.baseDir 的 settingsDir
- **WHEN** 配置设置 `runtime.settingsDir = "../outside"` 这类会逃出 `runtime.baseDir` 的相对路径
- **THEN** 系统报告配置错误并阻断受控工具
- **AND** 系统不得在 `runtime.baseDir` 外写入 SRT settings

### Requirement: Session 授权空闲过期
系统 SHALL 为“本 session 始终允许”的授权设置空闲 TTL，并在授权长时间不再使用后自动清理。过期授权 MUST NOT 继续跳过确认。

#### Scenario: 授权在 TTL 内复用
- **WHEN** 用户选择“本 session 始终允许”后，在 `runtime.sessionAllowTtlMs` 内再次触发相同授权 key
- **THEN** 系统跳过确认并刷新该授权的最近使用时间

#### Scenario: 授权空闲超时后重新确认
- **WHEN** 用户选择“本 session 始终允许”后，超过 `runtime.sessionAllowTtlMs` 未再次使用该授权 key
- **THEN** 系统清理该授权
- **AND** 下次相同工具调用必须重新请求用户确认

#### Scenario: 禁用 session 授权复用
- **WHEN** `runtime.sessionAllowTtlMs` 小于或等于 0
- **THEN** 用户选择“本 session 始终允许”只放行当前调用
- **AND** 系统不得写入 session 授权缓存

### Requirement: Named permission profiles
系统 SHALL 支持 Codex 风格 named permission profiles，用 `permissions.<name>` 同时描述文件系统、网络和高风险能力边界。普通用户 SHOULD 能通过选择 profile 表达常见权限姿态，而不必理解底层 SRT 字段。

#### Scenario: 选择 active permission profile
- **WHEN** 配置声明 `activePermissionProfile = "workspace"` 且存在 `permissions.workspace`
- **THEN** 系统使用 `permissions.workspace` 作为当前工具调用的有效权限边界
- **AND** `/pi-perm` 摘要显示当前 active permission profile

#### Scenario: 文件系统权限使用 read write deny
- **WHEN** 配置在 `permissions.workspace.filesystem` 或其 scope 子表中声明路径权限为 `read`、`write` 或 `deny`
- **THEN** 系统将这些条目规范化为有效文件系统权限模型
- **AND** 系统拒绝除 `read`、`write`、`deny` 之外的权限值

#### Scenario: workspace roots 子路径不能逃逸
- **WHEN** 配置在 `permissions.workspace.filesystem.":workspace_roots"` 下声明 `../outside`
- **THEN** 系统报告配置错误
- **AND** 系统不得将 workspace 外路径纳入该 workspace-scoped 规则

#### Scenario: deny 优先级高于 write 和 read
- **WHEN** 同一目标路径同时命中较宽的 `write` 规则和更具体的 `deny` 规则
- **THEN** 系统按 `deny` 处理该目标路径
- **AND** 工具调用不得读写该目标

#### Scenario: 内置 workspace profile
- **WHEN** 用户未提供自定义 `permissions.workspace`
- **THEN** 系统提供内置 workspace profile
- **AND** 该 profile 允许 workspace roots 内普通读写，拒绝敏感文件读取，网络默认关闭

#### Scenario: 旧 sandbox 权限配置被拒绝
- **WHEN** 配置没有声明 `permissions` 且仍使用 `profiles.<active>.sandbox.filesystem.allowRead`、`allowWrite`、`denyRead` 或 `denyWrite`
- **THEN** 系统报告配置错误并 fail-closed
- **AND** 错误信息提示用户迁移到 `permissions.<name>.filesystem`

### Requirement: Boundary-first bash approval
系统 SHALL 将 bash 审批建立在有效权限边界上。沙盒边界内且未命中高风险规则的 bash 命令 SHALL 自动允许；越过文件系统、网络或高风险能力边界的命令 MUST 按策略确认或阻断。

#### Scenario: workspace 内普通 bash 命令自动允许
- **WHEN** 当前 permission profile 允许 workspace 写入且 `bash` 命令未命中 block/confirm operations、未请求网络、未访问边界外路径
- **THEN** 系统允许该 bash 调用
- **AND** 系统不得向用户请求确认

#### Scenario: 危险命令仍需要确认
- **WHEN** `bash` 命令命中 `tools.bash.operations.confirm` 中的危险操作，例如 `git push`、`sudo`、`rm -r` 或 `curl | sh`
- **THEN** 系统在执行前请求用户确认
- **AND** session 级授权逻辑继续适用

#### Scenario: 阻断规则优先于默认放行
- **WHEN** `bash` 命令命中显式 `rules` 或 `operations.block`
- **THEN** 系统直接阻断该调用
- **AND** 系统不得因为 `tools.bash.defaultAction = "allow"` 而放行该调用

#### Scenario: 网络关闭时联网命令需要确认
- **WHEN** 当前 permission profile 的 `network.enabled = false` 且 `bash` 命令明显请求外部网络访问
- **THEN** 系统返回 `confirm` 或配置化 `block` 决策
- **AND** 系统不得静默放行该网络访问

#### Scenario: 网络允许但域名 deny 优先
- **WHEN** 当前 permission profile 启用网络且目标域名同时命中 allow 和 deny 规则
- **THEN** 系统按 deny 处理该网络目标
- **AND** 工具调用不得因较宽 allow 规则自动放行

#### Scenario: SRT 包装使用有效 permission profile
- **WHEN** `bash` 调用允许执行且 `wrapWithSrt = true`
- **THEN** 系统使用当前有效 permission profile 生成 SRT settings
- **AND** 生成结果包含文件系统、网络和 Unix socket 边界

### Requirement: Simplified configuration examples
系统 SHALL 在默认配置、示例配置和文档中以 named permission profiles 作为主配置入口，并将 `tools.bash.operations` 描述为高级例外规则。

#### Scenario: 示例配置展示简化主路径
- **WHEN** 用户查看 `config.example.toml`
- **THEN** 示例首先展示 `activePermissionProfile`、`permissions.<name>.filesystem` 和 `permissions.<name>.network`
- **AND** 示例不要求用户通过 operations allowlist 才能放行普通项目内命令

#### Scenario: 高级 operations 仍可配置
- **WHEN** 用户需要对特定命令模式设置 `block`、`confirm` 或 `allow`
- **THEN** 用户仍可配置 `tools.bash.operations`
- **AND** 系统按该例外规则覆盖默认边界内放行行为

#### Scenario: 文档说明旧配置迁移但不承诺兼容
- **WHEN** 用户阅读业务文档或 README
- **THEN** 文档说明旧 `profiles.<name>.sandbox.filesystem.allowRead/allowWrite/denyRead/denyWrite` 与新 `permissions.<name>.filesystem` 的映射关系
- **AND** 文档说明旧配置模式已不再兼容，用户必须迁移

### Requirement: 确认等待期间显示 blocked 状态
系统 SHALL 在等待用户处理 `confirm` 权限提示期间，显示 blocked 风格的 UI 状态，表明 agent 当前被用户授权输入阻塞。

#### Scenario: 显示等待授权状态
- **WHEN** 工具调用需要用户确认且没有命中当前 session 授权缓存
- **THEN** 系统在展示确认提示前设置 `pi-perm` 状态和 working 文案，说明当前正在等待权限确认

#### Scenario: 通知 Herdr 进入 blocked 状态
- **WHEN** 工具调用需要用户确认且扩展运行环境提供 Pi event bus
- **THEN** 系统在展示确认提示前发送 `herdr:blocked` 事件，payload 包含 `active: true` 和当前授权等待说明

#### Scenario: 用户选择后恢复状态
- **WHEN** 用户选择拒绝、允许一次或本 session 始终允许
- **THEN** 系统在确认提示结束后恢复默认 working 状态

#### Scenario: 通知 Herdr 退出 blocked 状态
- **WHEN** 用户选择拒绝、允许一次、本 session 始终允许，或确认 UI 异常结束
- **THEN** 系统发送 `herdr:blocked` 事件，payload 包含 `active: false` 和同一个授权等待说明

#### Scenario: Herdr done 由 idle/unseen 派生
- **WHEN** 权限确认结束后 Herdr 需要显示完成态
- **THEN** 系统不发送 `done` 状态事件，而是释放 blocked 状态，让 Herdr 根据 idle 和 pane seen 状态自行显示 done 或 idle

#### Scenario: UI 异常后恢复状态
- **WHEN** 确认提示抛出异常或被取消
- **THEN** 系统在返回或继续抛出结果前恢复默认 working 状态

#### Scenario: Session 授权命中不显示 blocked 状态
- **WHEN** 工具调用因当前 session 授权缓存而跳过确认
- **THEN** 系统不设置 blocked 风格等待状态，也不发送 Herdr blocked 或 done 事件，因为此时没有等待用户输入

