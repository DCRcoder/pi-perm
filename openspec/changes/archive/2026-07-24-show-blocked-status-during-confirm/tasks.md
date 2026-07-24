## 1. 实现

- [x] 1.1 在 `core/extension.ts` 的权限确认流程外层增加 UI 状态保护
- [x] 1.2 确保拒绝、允许一次、允许当前 session、取消和 UI 异常路径都会恢复默认 working 状态
- [x] 1.3 通过 Pi event bus 向 Herdr Pi integration 发送 blocked active true/false 事件
- [x] 1.4 明确 Herdr done 由 idle/unseen 派生，pi-perm 不发送无效 done 状态

## 2. 验证

- [x] 2.1 添加测试，验证显示确认提示前会设置 blocked 风格状态，并在提示结束后恢复
- [x] 2.2 添加测试，验证命中 session 授权缓存时不会设置 blocked 状态
- [x] 2.3 添加测试，验证 Herdr blocked 事件由扩展初始化注入的 Pi event bus 发送
- [x] 2.4 添加测试，验证 pi-perm 不发送 Herdr done 事件
- [x] 2.5 运行 `pnpm test` 和 `pnpm run typecheck`
