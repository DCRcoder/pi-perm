## Context

`pi-perm` 当前 `core/audit.ts` 实现：

```typescript
export function auditEvent(config: any, event: any, cwd = process.cwd()) {
  if (!config.audit?.enabled) return;
  const file = path.resolve(cwd, config.audit.file ?? "audit.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}
```

问题点：
- `path.resolve(cwd, ...)` 把审计文件锚定到 `process.cwd()`，在每个项目目录创建 `audit.jsonl`。
- `applySecurityBoundary` 产生的降级审计在 `createPiPermExtension()` 启动时一次性写入（也是同样的 `cwd`）。
- 用户当前**无法**把审计文件移到项目目录外，唯一可控的是 `audit.file` 这个相对路径。

SRT settings 已经采用"基于 `runtime.baseDir` 解析"的模式：

```typescript
export function resolveSrtSettingsDir(config: any, runtimeBaseDir: string) {
  const settingsDir = config.runtime?.settingsDir ?? "runtime";
  if (path.isAbsolute(settingsDir)) {
    throw new Error("runtime.settingsDir must be a relative path under runtime.baseDir");
  }
  const resolved = path.resolve(runtimeBaseDir, settingsDir);
  if (!isPathInside(runtimeBaseDir, resolved)) {
    throw new Error("runtime.settingsDir must stay under runtime.baseDir");
  }
  return resolved;
}
```

本次变更为审计文件复用同样的模式，保持扩展状态目录治理的一致性。

## Goals / Non-Goals

**Goals:**
- 审计文件默认写入 `runtime.baseDir/audit.jsonl`。
- `audit.file` 仍为相对路径配置项，文件名可控。
- 绝对 `audit.file` 在配置校验阶段被拒绝。
- 逃出 `runtime.baseDir` 的 `audit.file` 在配置校验阶段被拒绝。
- 路径解析在 `loadConfig` 中完成，运行时不重新 resolve。
- 降级审计（`applySecurityBoundary`）也走 `state.auditFile`。
- 项目目录不再产生 `audit.jsonl`。
- 所有现有测试继续通过；新增覆盖新行为。

**Non-Goals:**
- 不引入 `audit.dir` 新字段。
- 不支持多文件/分片。
- 不改审计事件 schema。
- 不做日志轮转、压缩、外部转发。
- 不实现"按 profile 拆分日志"。

## Decisions

### 决策 1：在 `core/config.ts` 新增 `resolveAuditFile(config, runtimeBaseDir)`

签名：

```typescript
export function resolveAuditFile(config: any, runtimeBaseDir: string): string {
  const file = config.audit?.file ?? "audit.jsonl";
  if (typeof file !== "string" || !file) {
    throw new Error("audit.file must be a non-empty string");
  }
  if (path.isAbsolute(file)) {
    throw new Error("audit.file must be a relative path under runtime.baseDir");
  }
  const resolved = path.resolve(runtimeBaseDir, file);
  if (!isPathInside(runtimeBaseDir, resolved)) {
    throw new Error("audit.file must stay under runtime.baseDir");
  }
  return resolved;
}
```

复用现有 `isPathInside` helper（`core/config.ts` 内部已存在）。

### 决策 2：`auditEvent` 签名改为 `(config, event, auditFile)`

- 移除 `cwd` 参数。
- 增加 `auditFile` 必填参数（绝对路径）。
- `audit.enabled = false` 时直接 return。
- 文件夹自动创建；写文件用 `fs.appendFileSync`。

### 决策 3：`state` 增 `auditFile` 字段

`createPiPermExtension()` 中：

```typescript
const auditFile = resolveAuditFile(loaded.config, runtimeBaseDir);
const state = {
  config: loaded.config,
  activeProfile: loaded.config.activeProfile,
  cwd: options.cwd ?? process.cwd(),
  runtimeBaseDir,
  srtSettingsDir: resolveSrtSettingsDir(loaded.config, runtimeBaseDir),
  auditFile,
  ...
};
for (const event of loaded.audit) auditEvent(state.config, event, auditFile);
```

`handleToolCall`、`handlePiPermCommand` 中所有 `auditEvent(state.config, event, state.cwd)` 改为 `auditEvent(state.config, event, state.auditFile)`。

### 决策 4：默认值不变

`defaults/base.toml` 中 `audit.file = "audit.jsonl"` 保持不变，含义由"项目目录"变为"runtime.baseDir/audit.jsonl"。无需用户改配置。

### 决策 5：错误处理

- 解析失败（绝对路径、逃出）由 `loadConfig` 抛出 `Error`。
- `createPiPermExtension` 不再 `try/catch`，由 `loadConfig` 异常透传给 Pi，遵循现有 fail-closed 模式。
- `audit.enabled = false` 时 `auditEvent` 静默 return，不抛错。

### 决策 6：测试策略

- `test/config.test.ts`：新增 `resolveAuditFile` 单元测试，覆盖默认值、相对路径、绝对路径报错、逃出报错。
- `test/extension.test.ts`：新增"audit 文件不写 cwd"集成测试：构造 `cwd`、调用 `handleToolCall` 触发审计事件，断言 `cwd/audit.jsonl` 不存在、`runtimeBaseDir/audit.jsonl` 存在。
- 现有测试 fixture 中 `audit.enabled = false` 的无需修改；启用 audit 的 fixture 需要传入 `auditFile` 才能跑通（fixture 中应注入一个 tmp 目录）。

### 决策 7：不保留 cwd 兼容

- 不提供 `audit.file` 兼容模式（旧值"audit.jsonl"在新代码中已变基目录）。
- 不做"如果配置是 audit.jsonl 默认值则写 cwd"分支。
- 在版本记录和 README 中说明"自 v0.2 起 audit 默认在 extension 数据目录"。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 旧用户期望 `audit.jsonl` 在项目目录被破坏 | 在 README + 版本记录中明确告知；fail-closed 不影响功能，只是日志位置变化 |
| 极端用户在 `audit.file` 中配置 `..` 逃出 | 配置校验拒绝；测试覆盖 |
| `state.auditFile` 缺失导致运行时错误 | `createPiPermExtension` 强制 `resolveAuditFile`；运行时所有 `auditEvent` 调用都用 `state.auditFile` |
| 多 extension 共用 `runtime.baseDir` 时 audit 冲突 | 现有 `runtime.settingsDir` 也是同样问题，沿用 `audit.jsonl` 单文件即可；如未来要切分，扩展配置字段（不在本变更范围） |
| 用户期望 audit 在项目目录用于本地调试 | 可临时改 `runtime.baseDir` 或在 `audit.enabled = false` 后自己挂日志回调；本变更不阻止用户写自己的 audit 逻辑 |

## 行为边界

- **不**支持把 audit 文件写回项目目录（`audit.file = "./audit.jsonl"` 会被解析为 `<runtimeBaseDir>/./audit.jsonl`，等价于 `<runtimeBaseDir>/audit.jsonl`，不会落到 cwd）。
- **不**支持绝对路径。
- **不**支持 `..` 逃出。
- **不**支持多文件输出。
- `audit.enabled = false` 时不写任何文件。

## Migration Plan

1. **代码层**：
   - `core/config.ts`：新增 `resolveAuditFile` + `isPathInside` 复用。
   - `core/audit.ts`：签名变更。
   - `core/extension.ts`：`state.auditFile` + 所有 `auditEvent` 调用更新。
2. **测试**：
   - `test/config.test.ts`：新增 `resolveAuditFile` 测试。
   - `test/extension.test.ts`：新增"audit 不污染 cwd"集成测试；现有 fixture 中 `audit.enabled = false` 不动。
3. **文档**：
   - `README.zh-CN.md`：说明 audit 文件位置变化。
   - `doc/PiPerm实现文档.md`：扩展状态目录章节补 audit。
   - `doc/版本记录.md`：记录 BREAKING 变化。
   - `config.example.toml`：注释说明 audit 路径。
4. **验证**：
   - `pnpm test` 全部通过（含新增）。
   - `pnpm run typecheck` 通过。
5. **回滚**：如发现破坏性影响，关闭 audit（`audit.enabled = false`）作为临时缓解；正式回滚需还原 `core/audit.ts` 签名。

## Open Questions

无。
