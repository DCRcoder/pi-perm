## Why

当前默认策略让 `bash` 命令过多落入确认流程，用户需要频繁批准低风险的项目内读写、测试和检查命令，影响 agent 连续工作。现有 TOML 同时暴露 profile、sandbox、filesystem、network、operations 多层配置，人类需要理解过多底层字段才能表达常见权限意图。

本变更参考 Codex 的 sandbox + approval policy + named permission profiles 模型，将主配置入口收敛为可命名的权限 profile：先用沙盒边界描述技术权限，再只对越界或高风险操作确认，从而降低确认疲劳并减少配置理解成本。

## What Changes

- 新增 Codex 风格 `permissions` named profiles，使用路径到 `read`、`write`、`deny` 的映射描述文件系统权限，使用 `network.enabled` 和 domain/socket 规则描述网络权限。
- 新增内置 profile 语义：`:read-only`、`:workspace`、`:workspace-network`、`:danger-full-access`，普通用户可通过 `activePermissionProfile` 或现有 active profile 选择低成本权限姿态。
- 修改默认 `bash` 行为：在沙盒边界内的普通命令默认 `allow`，只有命中危险操作、越过文件/网络边界、需要高风险能力或显式 `confirm` 规则时才请求用户确认。
- 保留 `tools.bash.operations` 作为高级例外规则，用于 block/confirm/allow 特定命令模式；不再要求普通用户通过 operations 解释常规 bash 放行。
- **BREAKING** 移除旧 `profiles.<name>.sandbox.filesystem.allowRead/allowWrite/denyRead/denyWrite` 主配置模式；配置必须迁移到 `permissions.<name>`。
- 更新配置样例和业务文档，展示简化后的主配置写法和迁移路径。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pi-sandbox-permissions`: 修改配置化权限控制、命令操作权限审批、文件工具权限判定和 Profile 管理相关行为，新增 named permission profiles、简化配置入口和 bash 低风险自动放行语义。

## Impact

- 影响 `core/config.ts`：新增 permission profile 数据结构解析、默认值、校验、旧配置拒绝和摘要字段。
- 影响 `core/policy.ts`：文件工具和 bash 决策需要使用统一有效权限模型，区分边界内自动放行与越界确认/阻断。
- 影响 `core/srt.ts`：SRT settings 需要可从新 permission profile 生成文件系统、网络和高风险能力配置。
- 影响 `core/extension.ts`：确认触发点和策略摘要需要反映边界越界、危险操作和 session 授权。
- 影响 `defaults/base.toml`、`config.example.toml`、`README*` 和 `doc/PiPerm实现文档.md`：默认策略和示例改为简化配置。
- 影响测试：需要覆盖新配置加载、旧配置兼容、bash 自动放行、危险命令确认、文件路径 precedence、网络关闭和配置摘要。
