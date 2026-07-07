## 1. 配置模型与兼容

- [x] 1.1 在配置加载层新增 `permissions`、`activePermissionProfile`、文件系统 access entry 和网络规则的解析与校验
- [x] 1.2 实现内置 `:read-only`、`:workspace`、`:workspace-network`、`:danger-full-access` profile 注入
- [x] 1.3 实现旧 `profiles.<name>.sandbox` 权限主配置的拒绝逻辑，错误信息包含迁移提示
- [x] 1.4 更新 `applySecurityBoundary()`，让新 permission profile 的高风险字段经过 user config 授权降级

## 2. 权限判定与 SRT 生成

- [x] 2.1 更新文件工具判定，按 effective permission profile 的 read/write/deny precedence 决策
- [x] 2.2 更新 bash 判定顺序，使 rules/operations 优先，边界内普通命令默认 allow
- [x] 2.3 增加 bash 边界检查，识别明显网络请求、文件写入/删除/移动和边界外目标
- [x] 2.4 更新 SRT settings 生成逻辑，使其从 effective permission profile 输出文件系统、网络和 Unix socket 边界
- [x] 2.5 更新 `/pi-perm` 和 `pi_perm_policy` 摘要，展示 active permission profile 与简化权限摘要

## 3. 默认配置与文档

- [x] 3.1 更新 `defaults/base.toml`，默认使用 workspace permission profile，bash 边界内默认 allow
- [x] 3.2 更新 `config.example.toml`，将 named permission profiles 作为主示例，operations 作为高级例外
- [x] 3.3 更新 README 和中文 README，说明新配置主路径、旧配置不再兼容和迁移映射
- [x] 3.4 更新业务文档和版本记录，记录本次权限模型与用户体验变化

## 4. 测试与验证

- [x] 4.1 增加配置测试：新 `permissions` 解析、非法 access、workspace 子路径逃逸和旧配置拒绝
- [x] 4.2 增加 policy 测试：workspace 内 bash 自动允许、危险 operations 确认、block 优先、网络关闭确认
- [x] 4.3 增加文件权限测试：deny 优先、write 覆盖 read、只读路径不可写、边界外路径确认
- [x] 4.4 增加 SRT 生成测试：新 permission profile 能生成核心 sandbox 边界
- [x] 4.5 运行相关测试命令并修复失败项
