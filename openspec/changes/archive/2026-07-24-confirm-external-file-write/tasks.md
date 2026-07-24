## 1. 策略判定

- [x] 1.1 在 `evaluateFileAccess()` 中为 `write/edit` 未授权且未 deny 的路径返回专用 `external-file-write-boundary` 确认决策
- [x] 1.2 保持 deny 优先、允许路径自动放行、多目标路径按最严格结果处理

## 2. Session 授权验证

- [x] 2.1 增加外部 `write/edit` 允许一次后再次请求确认的测试
- [x] 2.2 增加外部 `write/edit` 本 session 始终允许后相同目标跳过确认的测试
- [x] 2.3 增加本 session 授权不适用于不同外部目标的测试
- [x] 2.4 增加外部 `write/edit` 文件夹级 session 授权复用同一文件夹的测试
- [x] 2.5 增加外部 `write/edit` 文件夹级 session 授权不跨文件夹的测试
- [x] 2.6 增加多目标不在同一文件夹时不写入文件夹级 session 授权的测试

## 3. 文档与回归

- [x] 3.1 更新业务实现文档，说明外部目录写入的交互式授权行为
- [x] 3.2 运行 `pnpm test` 验证回归
- [x] 3.3 运行 `pnpm run typecheck` 验证类型检查
