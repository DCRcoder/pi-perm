## 1. 实现

- [x] 1.1 在配置和 extension state 中加入 extension 运行时基目录解析
- [x] 1.2 修改 SRT settings 写入接口，禁止通过当前项目 cwd 解析 runtime 目录
- [x] 1.3 更新默认配置，增加 `runtime.baseDir` 和 `runtime.sessionAllowTtlMs`
- [x] 1.4 将 session 授权缓存改为带 `lastUsedAt` 的 Map，并实现空闲 TTL 清理
- [x] 1.5 更新审计记录中的 SRT settings 路径显示逻辑

## 2. 验证

- [x] 2.1 添加测试，验证默认 SRT settings 写入 extension 数据目录且不创建项目根 `runtime/`
- [x] 2.2 添加测试，验证相对 `runtime.settingsDir` 解析到 `runtime.baseDir` 下
- [x] 2.3 添加测试，验证绝对 `runtime.settingsDir` 和逃出 `runtime.baseDir` 的相对路径被拒绝
- [x] 2.4 添加测试，验证 session 授权空闲过期后会重新请求确认
- [x] 2.5 运行 `pnpm test` 和 `pnpm run typecheck`
  - 本环境缺少 `pnpm` 可执行文件；已用等价命令 `node --import ./node_modules/tsx/dist/esm/index.mjs --test test/*.test.ts` 和 `./node_modules/.bin/tsc --noEmit` 验证通过。
