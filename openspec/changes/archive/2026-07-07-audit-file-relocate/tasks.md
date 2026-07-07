## 1. 路径解析

- [x] 1.1 在 `core/config.ts` 新增 `resolveAuditFile(config, runtimeBaseDir)`：默认 `audit.jsonl`、相对路径追加、绝对路径和逃出 `runtime.baseDir` 抛错
- [x] 1.2 复用 `core/config.ts` 现有 `isPathInside` helper 检查逃出

## 2. auditEvent 改造

- [x] 2.1 在 `core/audit.ts` 修改 `auditEvent` 签名：`(config, event, auditFile)`，移除 `cwd` 参数
- [x] 2.2 `auditEvent` 直接用 `auditFile` 写文件，父目录用 `fs.mkdirSync(..., { recursive: true })` 自动创建

## 3. Extension 接入

- [x] 3.1 在 `core/extension.ts:createPiPermExtension` 中通过 `resolveAuditFile(loaded.config, runtimeBaseDir)` 解析审计路径，存到 `state.auditFile`
- [x] 3.2 替换 `core/extension.ts` 中所有 `auditEvent(state.config, event, state.cwd)` 为 `auditEvent(state.config, event, state.auditFile)`
- [x] 3.3 替换 `loaded.audit` 的降级审计循环为 `auditEvent(state.config, event, auditFile)`

## 4. 默认配置与示例

- [x] 4.1 `defaults/base.toml` 中 `audit.file = "audit.jsonl"` 保持不变（含义自动变为 runtime.baseDir 下），无需修改
- [x] 4.2 `config.example.toml` 注释说明 audit 路径解析到 runtime.baseDir

## 5. 文档

- [x] 5.1 更新 `README.zh-CN.md`：说明 audit 文件位置变化、配置项含义
- [x] 5.2 更新 `doc/PiPerm实现文档.md`：扩展状态目录章节补 audit
- [x] 5.3 更新 `doc/版本记录.md`：记录 BREAKING 变化（audit.jsonl 不再写入项目目录）

## 6. 验证

- [x] 6.1 在 `test/config.test.ts` 新增 `resolveAuditFile` 测试：默认值、相对路径追加、绝对路径拒绝、逃出拒绝
- [x] 6.2 在 `test/extension.test.ts` 新增集成测试："audit 不污染 cwd"，构造独立 cwd 和 runtimeBaseDir，调用 `handleToolCall` 触发审计，断言 cwd 不存在 audit.jsonl，runtimeBaseDir 存在 audit.jsonl
- [x] 6.3 运行 `pnpm test` 全部通过
- [x] 6.4 运行 `pnpm run typecheck` 全部通过
