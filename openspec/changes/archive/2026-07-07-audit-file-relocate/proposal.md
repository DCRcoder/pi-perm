## 背景

当前 `core/audit.ts:auditEvent` 把审计日志文件路径解析为 `path.resolve(cwd, config.audit.file ?? "audit.jsonl")`，即直接写入 `process.cwd()`。`defaults/base.toml` 中 `audit.file = "audit.jsonl"` 会在每个项目的工作目录创建 `audit.jsonl`，污染用户工作区，影响版本控制、`.gitignore` 维护和项目目录整洁度。

与 SRT settings 一样，审计文件属于 pi-perm 自身状态，不属于当前项目文件，理应写入 `~/.pi/agent/extensions/pi-perm/`（`runtime.baseDir`）下。

## 目标

- 审计日志默认写入 `~/.pi/agent/extensions/pi-perm/audit.jsonl`，不污染当前项目目录。
- 用户可通过 `audit.file` 配置相对文件名（默认 `audit.jsonl`），最终路径解析为 `runtime.baseDir` 下的相对子路径，与 SRT settings 行为一致。
- 拒绝绝对 `audit.file` 路径，避免用户绕过扩展把日志写入任意位置。
- 拒绝通过相对路径逃出 `runtime.baseDir` 的 `audit.file`（如 `audit.file = "../escape"`）。
- 与 SRT settings 一样，路径解析在配置加载阶段完成并写入 `state`，运行时直接用绝对路径写文件。
- **BREAKING**：现有用户如果依赖 `audit.jsonl` 写入项目目录，需手动迁移历史日志并更新配置（如把 `audit.file = "audit.jsonl"` 改为 `audit.file = "audit.jsonl"` —— 默认行为已经迁到 extension 数据目录；如需保留项目目录写入，显式设置 `audit.file = "/abs/path/audit.jsonl"` 会被拒绝，需要改用 git 排除或环境变量覆盖）。

## 非目标

- 不引入新配置项 `audit.dir`；`runtime.baseDir` 已经是单一基目录入口。
- 不支持多个审计文件或多份日志分片。
- 不改变审计事件的字段格式（`type`、`toolName`、`action`、`reason`、`ruleId`、`target`、`time` 等保持现状）。
- 不实现日志轮转、压缩、加密或外部日志服务转发。
- 不修改 `applySecurityBoundary` 的降级审计行为；该行为仍然走 `loaded.audit`，在 extension 启动时一次性写入。

## 用户故事

- 作为项目用户，我希望 agent 跑完一轮后工作目录里**不会**出现 `audit.jsonl` 文件，仓库保持干净。
- 作为高级用户，我希望 `audit.file` 仍然是相对路径配置项，文件名可控，但解析基目录固定为 `runtime.baseDir`，不会逃出 extension 数据目录。
- 作为审计合规用户，我希望降级审计（`applySecurityBoundary`）的事件也写入 extension 数据目录，而不是项目目录。

## What Changes

- 新增 `resolveAuditFile(config, runtimeBaseDir)`（`core/config.ts`）：把 `config.audit.file` 解析为 `runtime.baseDir` 下的绝对路径；绝对路径或逃出 `runtime.baseDir` 的路径在配置校验阶段被拒绝。
- 修改 `core/audit.ts:auditEvent`：签名从 `(config, event, cwd)` 改为 `(config, event, auditFile)`，运行时直接用绝对路径写文件，不再 resolve cwd。
- 修改 `core/extension.ts`：在 `createPiPermExtension()` 中通过 `resolveAuditFile` 解析审计文件路径，存到 `state.auditFile`；`handleToolCall`、`handlePiPermCommand` 中所有 `auditEvent` 调用改为传入 `state.auditFile`。
- `defaults/base.toml` 中 `audit.file` 保持 `"audit.jsonl"`，含义由"项目目录下"改为"runtime.baseDir 下"，行为变化但配置项不变。
- `core/extension.ts` 中 `loaded.audit` 的降级审计写入也用 `state.auditFile`。
- 同步更新 `README.zh-CN.md`、`doc/PiPerm实现文档.md`、`doc/版本记录.md`、`config.example.toml`。
- 新增单测覆盖：默认 audit 路径解析到 `runtimeBaseDir`、相对路径追加、绝对路径拒绝、路径逃出拒绝、运行时不写 cwd。

## Capabilities

### New Capabilities

无。本次变更是对现有 `pi-sandbox-permissions` 能力中"审计记录"的实现位置变更，不引入新 capability。

### Modified Capabilities

- `pi-sandbox-permissions`：本次变更修改"审计记录"Requirement 的行为：审计文件必须写入 `runtime.baseDir` 下，不得写入当前项目目录。

## Impact

| 范围 | 影响 |
|------|------|
| 配置 | `audit.file` 仍为相对路径字符串；绝对路径被配置校验拒绝 |
| 行为 | 默认审计路径从 `<cwd>/audit.jsonl` 改为 `<runtime.baseDir>/audit.jsonl` |
| 代码 | `core/audit.ts`、`core/config.ts`、`core/extension.ts` |
| 测试 | `test/config.test.ts` 新增 `resolveAuditFile` 测试；`test/extension.test.ts` 新增"audit 文件不写 cwd"集成测试 |
| 文档 | `README.zh-CN.md`、`doc/PiPerm实现文档.md`、`doc/版本记录.md` 同步 |
| 向后兼容 | 旧用户配置 `audit.jsonl` 仍在项目目录的历史日志需手动迁移；运行时不创建项目目录 `audit.jsonl` 属于预期行为变化 |
