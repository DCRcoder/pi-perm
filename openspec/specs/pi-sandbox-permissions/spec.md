# pi-sandbox-permissions Specification

## Purpose
TBD - created by archiving change add-pi-sandbox-permissions-extension. Update Purpose after archive.
## Requirements
### Requirement: 配置化权限控制
系统 SHALL 通过配置文件定义工具拦截、profile、命令操作权限、文件系统、网络、Unix socket、提示、审计和 SRT 包装行为。除 schema、安全兜底和加载路径外，代码 MUST NOT 硬编码具体业务路径、网络域名、命令白名单或 profile 行为。

#### Scenario: TOML 配置优先
- **WHEN** package 根目录同时存在 `config.toml` 和 `config.json`
- **THEN** 系统优先读取 `config.toml`，并保留 `config.json` 作为兼容格式

#### Scenario: 从配置加载控制规则
- **WHEN** extension 启动并存在默认配置、项目配置和用户配置
- **THEN** 系统按定义顺序合并配置，并使用合并后的 active profile 处理工具调用

#### Scenario: 禁止代码硬编码策略
- **WHEN** 需要调整允许写入路径、允许访问域名或工具默认动作
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
系统 SHALL 在执行 `bash` 工具前按配置化命令操作规则进行确认或阻断。该能力 MUST NOT 依赖 sandbox-runtime，必须能覆盖删除、权限修改、Git 写入、提权、远程脚本执行、凭据访问、网络外传、依赖安装、制品发布、容器、云资源和系统自动化等风险操作。

#### Scenario: 命令操作规则来自配置
- **WHEN** 用户在配置中新增或修改 `tools.bash.operations` 规则
- **THEN** 系统按该配置决定命令操作的 `allow`、`block` 或 `confirm` 动作，不要求修改代码

#### Scenario: 配置样例和字段说明可用
- **WHEN** 用户查看项目文档或配置示例
- **THEN** 系统提供 TOML 样例和字段说明，包括 `preset`、`block`、`confirm`、`allow`、常用原命令模式，以及 `advanced` 中的 `id`、`category`、`command`、`subcommands`、`argvIncludes`、`commandIncludes`、`commandIncludesAll`、`action` 和 `reason`

#### Scenario: 使用原命令模式配置操作权限
- **WHEN** 用户在 `tools.bash.operations.confirm` 中配置 `git push` 或 `curl | sh`
- **THEN** 系统展开原命令模式并对对应命令操作执行确认，不要求用户书写底层 matcher

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
系统 SHALL 在确认提示中支持“允许一次”和“本 session 始终允许”。session 级授权 MUST 只在当前 extension 实例生命周期内生效，MUST NOT 写入配置或跨 session 持久化。

#### Scenario: 用户选择允许一次
- **WHEN** 工具调用命中 `confirm` 规则且用户选择“允许一次”
- **THEN** 系统放行当前调用，不写入 session 授权缓存，并在下一次命中同一规则和目标时再次请求确认

#### Scenario: 用户选择本 session 始终允许
- **WHEN** 工具调用命中 `confirm` 规则且用户选择“本 session 始终允许”
- **THEN** 系统放行当前调用，并按 active profile、`toolName`、规则 ID 或操作 ID、目标摘要记录当前 session 授权 key

#### Scenario: 同一 session 内重复命中已授权目标
- **WHEN** 后续工具调用命中相同的 session 授权 key
- **THEN** 系统不再请求用户确认，直接放行该调用，并记录 session 授权命中审计

#### Scenario: 不同命令或路径仍需确认
- **WHEN** 用户已对一个命令或路径选择“本 session 始终允许”
- **THEN** 系统不得将该授权用于不同规则 ID、不同操作 ID 或不同目标摘要的工具调用

#### Scenario: 切换 profile 后授权失效
- **WHEN** 用户已对一个工具调用选择“本 session 始终允许”后执行 `/pi-perm use <profile>` 切换到另一个 profile
- **THEN** 系统清空当前 session 授权缓存，后续同名工具、规则和目标仍需重新确认

#### Scenario: UI 只支持布尔确认
- **WHEN** 运行环境只提供 `ctx.ui.confirm` 而不支持选项式确认
- **THEN** 系统保持兼容，用户确认成功只视为“允许一次”，不得写入 session 授权缓存

### Requirement: 文件工具权限判定
系统 SHALL 在配置启用时拦截文件类工具，并根据配置的路径规则和当前 profile 的文件系统策略决定允许、阻断或确认。

#### Scenario: 写入被拒绝路径
- **WHEN** `write` 或 `edit` 工具尝试访问配置中拒绝的路径
- **THEN** 系统在工具执行前阻断调用，并返回配置化的拒绝原因

#### Scenario: 需要用户确认的路径
- **WHEN** 文件工具访问命中 `confirm` 规则的路径
- **THEN** 系统通过 `ctx.ui.confirm` 请求用户确认，并根据用户选择允许或阻断该次调用

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
系统 SHALL 按配置记录权限判定、用户确认结果、策略降级、SRT settings 生成和阻断原因。

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
