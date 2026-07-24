## Context

pi-perm 当前通过 [core/policy.ts](../../../core/policy.ts) 的 `evaluateFileAccess()` 处理 `read`、`write`、`edit` 文件工具。函数会先解析工具配置中的 `pathFields`，再使用当前 effective permission profile 的 `resolveFilesystemAccess()` 判定每个目标路径的访问级别。

现状行为：

| 条件 | 当前行为 |
|------|----------|
| 任一目标命中 `deny` | 返回 `block` |
| `read` 目标全部为 `read` 或 `write` | 返回 `allow` |
| `write/edit` 目标全部为 `write` | 返回 `allow` |
| 目标未明确允许 | 回落到 `evaluateToolCall()`，通常由工具 `defaultAction` 决定 |

默认配置中 `tools.write.defaultAction` 和 `tools.edit.defaultAction` 已是 `confirm`，因此外部写入已有确认基础；但当前实现没有把“外部路径授权”表达成稳定的边界确认语义，也没有专门保证确认目标、session 授权 key 和文档行为都围绕路径目标收敛。

## Goals / Non-Goals

**Goals:**

- 对 `write` 和 `edit` 工具访问未被当前 permission profile 明确允许、且未被 deny 的路径时，稳定返回 `confirm`。
- 扩展现有 `confirmDecision()` 的选项 UI，让用户选择拒绝、允许一次、本 session 始终允许当前文件、本 session 始终允许当前文件夹。
- session 授权缓存必须以 active profile、工具名、确认规则 ID、授权范围和目标摘要为边界；文件级授权只复用相同文件，文件夹级授权复用同一文件夹下的后续 `write/edit` 目标。
- 保持 `deny` 优先，交互式授权不得绕过 deny。
- 增加自动化测试覆盖外部路径写入确认、允许一次、session 复用和 deny 优先。

**Non-Goals:**

- 不修改配置模型，不新增持久化授权配置。
- 不把外部路径写入加入 effective permission profile 或 SRT settings。
- 不解析 `bash` 命令里的任意文件写入目标；shell 解析风险高，本次只覆盖结构化文件工具。
- 不改变 `read` 工具的外部读取策略。

## Decisions

### Decision 1: 在 `evaluateFileAccess()` 内生成专用 confirm 决策

当 permission profile 存在且 `write/edit` 目标不是全部 `write`，同时没有任何目标命中 `deny` 时，直接返回：

| 字段 | 值 |
|------|----|
| `action` | `"confirm"` |
| `policy` | 当前文件工具 policy |
| `rule.id` | `"external-file-write-boundary"` |
| `reason` | `"Path requires user confirmation by permission profile: <target>"` |
| `target` | `targets.join(", ")` |

这样确认逻辑不会依赖 `tools.write.defaultAction` 是否被用户改成 `allow`。原因是外部写入属于越过当前 permission profile 文件系统边界的动作，应该由边界策略强制确认，而不是普通工具默认动作决定。

替代方案：继续回落到 `evaluateToolCall()`。放弃原因是用户若把 `tools.write.defaultAction = "allow"`，外部目录编辑会被自动放行，和“主动询问用户是否允许”的目标冲突。

### Decision 2: 扩展确认 UI 支持文件级和文件夹级 session 授权

[core/extension.ts](../../../core/extension.ts) 已对所有 `confirm` 决策统一执行：

1. 使用 `createSessionAllowKey(activeProfile, toolName, decision, target)` 生成授权 key。
2. 命中 `sessionAllows` 时直接放行并刷新 `lastUsedAt`。
3. 未命中时调用 `confirmDecision()`，用户可选择拒绝、允许一次、本 session 始终允许。
4. 本 session 始终允许只写入内存 Map，不写配置。

外部写入确认需要把 session 授权拆成两个范围：

| 授权范围 | UI 选项 | session key 目标摘要 | 命中条件 |
|----------|---------|----------------------|----------|
| 单次调用 | `Allow once` | 不写入缓存 | 仅当前工具调用 |
| 文件级 | `Always allow this file this session` | 当前目标文件路径摘要 | 相同 active profile、工具、规则和文件路径 |
| 文件夹级 | `Always allow this folder this session` | 当前目标所在文件夹路径摘要 | 相同 active profile、工具、规则，且后续目标位于同一文件夹 |

`confirmDecision()` 返回值需要从 `allow_session` 扩展为 `allow_file_session` 和 `allow_folder_session`，并继续兼容旧的 `allow_session` 输入，将其视为文件级 session 授权。`handleToolCall()` 在确认前先检查文件夹级授权，再检查文件级授权；命中任一授权均可跳过 UI 并记录 `session_allow_hit`。

文件夹级授权只适用于结构化文件工具的外部写入确认规则 `external-file-write-boundary`。普通 bash confirm、网络边界 confirm 和命令操作 confirm 继续使用原来的目标级 session 授权，避免把命令授权误解释成目录授权。

替代方案：把“本 session 始终允许”直接改为目录级授权。放弃原因是它会改变既有语义，且用户仍需要保留只允许单个文件的保守选择。

### Decision 3: 多目标写入按最严格结果处理

`evaluateFileAccess()` 对多路径工具调用保持现有优先级：

1. 任一目标为 `deny`：直接 `block`。
2. 所有目标都具备当前工具需要的访问级别：`allow`。
3. 其余情况：对全部目标摘要返回一次 `confirm`。

确认通过后只放行当前工具调用；若用户选择文件级 session 授权，session allow key 包含拼接后的目标摘要，因此只复用完全相同目标组合；若用户选择文件夹级 session 授权，session allow key 使用所有目标所在文件夹的摘要，并且只有后续目标位于同一文件夹时命中。

## Risks / Trade-offs

- [Risk] 路径目标字符串可能包含相对路径和绝对路径混用，导致同一物理路径生成不同 session key。→ Mitigation：本次保持现有 target 展示与缓存语义，避免引入路径规范化造成兼容性变化；后续如需要可单独增加 canonical target。
- [Risk] 如果 Pi 文件工具一次传入多个路径且目标分布在不同文件夹，文件夹级授权可能难以清晰表达。→ Mitigation：仅当所有目标位于同一文件夹时显示或接受文件夹级 session 授权；否则降级为文件级或单次授权。
- [Risk] 文件夹级授权扩大了 session 内的写入范围。→ Mitigation：授权仅在当前 extension 实例内存生效，不写配置；deny 仍优先，且不同 active profile、工具或规则不会复用。
- [Risk] `bash` 命令仍可能通过 shell 写外部目录。→ Mitigation：本变更明确不处理 bash 任意写入解析，继续依赖 SRT 和命令操作规则；结构化文件工具先解决用户高频痛点。

## Migration Plan

无需数据迁移。发布后默认 workspace profile 下的当前目录写入仍自动放行；外部未授权写入会进入确认流程；命中 deny 的路径继续直接阻断。回滚时删除本次代码和规范变更即可恢复旧行为。

## Open Questions

无。已确认本次采用文件工具层交互式授权方案，不新增配置项。
