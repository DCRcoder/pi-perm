## 1. 项目与配置结构

- [x] 1.1 创建根目录 Pi package 结构、`package.json`、`tsconfig.json` 和源码目录
- [x] 1.2 添加默认配置、项目配置示例和 README，说明 Pi 加载方式与 sandbox-runtime 依赖
- [x] 1.3 更新 TOML 配置示例和 README 字段说明，覆盖 `tools.bash.operations` 的 preset、原命令模式、confirm/block/allow 和 advanced 规则
- [x] 1.4 定义配置类型、运行时 schema、默认值和配置加载入口
- [x] 1.5 将 `core/` 和 `test/` 从 JavaScript 迁移为 TypeScript，并使用 `tsx` 运行测试

## 2. 策略合并与安全校验

- [x] 2.1 实现默认配置、项目配置、用户配置的加载和深合并
- [x] 2.2 实现 user-only elevation 校验，阻止项目配置单独启用高风险能力
- [x] 2.3 实现配置错误的 fail-closed 状态和可读错误输出

## 3. 工具拦截与 SRT 包装

- [x] 3.1 注册 `tool_call` 事件处理器，并按配置匹配工具策略与规则
- [x] 3.2 实现文件类工具路径提取、路径规则判定和 confirm/block/allow 动作
- [x] 3.3 实现 `bash` 命令操作权限规则解析、TOML 配置读取、原命令模式展开与 confirm/block/allow 动作
- [x] 3.4 实现 SRT settings 生成和 `bash` 命令包装逻辑
- [x] 3.5 处理 `srt` 缺失、UI 不可用、不支持平台等错误路径

## 4. 用户接口与审计

- [x] 4.1 注册 `/pi-perm` 命令，支持查看、列出、切换 profile 和查看审计摘要
- [x] 4.2 注册只读 `pi_perm_policy` 工具，返回当前策略摘要且不提供权限提升能力
- [x] 4.3 实现审计记录写入，覆盖允许、阻断、确认、降级和 SRT settings 生成
- [x] 4.4 在确认流程中提供“拒绝 / 允许一次 / 本 session 始终允许”选项，并在当前 extension 实例内缓存 session 授权

## 5. 验证

- [x] 5.1 添加配置加载合并、安全校验、规则判定和命令包装单元测试
- [x] 5.2 添加命令操作权限规则测试，覆盖 TOML 配置、原命令模式展开、`rm`、`git push`、`git reset --hard`、`sudo`、远程脚本执行、凭据访问、网络外传、发布操作、云/集群控制和 block 规则
- [x] 5.3 运行 TypeScript 类型检查和相关测试
- [x] 5.4 更新任务状态和实现说明，记录无法自动化验证的人工测试点
  - 人工测试点：通过 `pi -e ./index.ts` 或 `pi install ./relative/path` 加载 package；执行 `/pi-perm`、`/pi-perm list`、`/pi-perm use workspace`；安装 `@anthropic-ai/sandbox-runtime` 后用真实 `bash` 调用确认 `srt --settings` 包装和 OS 级阻断行为。
- [x] 5.5 添加 session 授权测试，覆盖允许一次仍重复询问、session 始终允许跳过重复询问、不同目标仍需确认、profile 切换清空缓存、旧 `ctx.ui.confirm` 兼容
