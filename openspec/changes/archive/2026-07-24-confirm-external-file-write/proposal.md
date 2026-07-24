## Why

当前默认 workspace profile 只自动允许当前 workspace 内写入。实际开发中经常需要从当前项目目录修改相邻仓库、生成外部目录文件或同步文档；用户现在必须提前修改 permission profile 配置，才能完成一次性外部目录编辑，流程过重。

本变更把未被 profile 明确允许且未被 deny 的外部文件写入改为交互式确认，让用户可以在工具调用发生时选择“允许一次”或“本 session 始终允许”，同时保持配置安全边界和审计能力。

## What Changes

- `write` 和 `edit` 文件工具访问当前 permission profile 未明确允许、但也未被 `deny` 的路径时，系统必须进入确认流程。
- 确认 UI 复用现有三选项：拒绝、允许一次、本 session 始终允许。
- 用户选择本 session 始终允许后，仅对相同 active profile、相同工具、相同外部目标摘要复用授权；不写入配置文件。
- `deny` 规则仍然优先于交互式授权，外部路径如果命中 deny 必须直接阻断。
- 不扩大 `bash` shell 命令的外部写入识别范围，本次只覆盖结构化文件工具 `write` 和 `edit`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `pi-sandbox-permissions`: 修改文件工具权限判定和 session 级确认授权要求，补充外部写入交互式授权行为。

## Impact

- 影响 [core/policy.ts](../../../core/policy.ts) 的文件路径访问判定。
- 影响 [core/extension.ts](../../../core/extension.ts) 的确认授权 key 和审计目标复用逻辑。
- 需要新增或更新 [test/policy.test.ts](../../../test/policy.test.ts)、[test/extension.test.ts](../../../test/extension.test.ts) 覆盖外部目录写入确认、允许一次、session 内始终允许和 deny 优先。
- 需要更新 [doc/PiPerm实现文档.md](../../../doc/PiPerm实现文档.md) 说明外部目录编辑的交互式授权。
