## 上下文

当前 `core/extension.ts` 在包装 `bash` 时读取 `state.config.runtime?.settingsDir ?? "runtime"`，然后调用 `writeSrtSettings({ cwd: state.cwd, runtimeDir })`。`core/srt.ts` 使用 `path.resolve(cwd, runtimeDir)` 生成 settings 文件，因此默认和相对路径都会落到当前项目目录下。

这类文件是 pi-perm extension 的运行时状态，生命周期与 extension 实例和工具调用相关，不应写入被操作项目。更合适的位置是用户级 Pi extension 数据目录，例如 `~/.pi/agent/extensions/pi-perm/runtime`。

## 设计决策

新增运行时目录解析边界：

1. 在配置层提供 pi-perm extension 数据目录常量，默认值为 `~/.pi/agent/extensions/pi-perm`。
2. 在创建 extension state 时计算 `runtimeBaseDir`。优先级为：
   - `options.runtimeBaseDir`，用于测试或宿主显式注入。
   - `config.runtime.baseDir`，用户配置的运行时基目录。
   - 默认 extension 数据目录。
3. `runtime.settingsDir` 只表示 `runtimeBaseDir` 下的子目录名，默认 `runtime`。
4. 如果 `runtime.settingsDir` 是绝对路径，拒绝继续沿用项目 cwd 解析；如果相对路径通过 `..` 逃出 `runtimeBaseDir`，同样报错。
5. `writeSrtSettings` 接收已经解析好的 `settingsDir` 绝对路径，不再接收 `cwd + runtimeDir` 的组合。
6. 审计中的 `settingsPath` 不再强行使用相对项目 cwd 的路径；若 settings 位于项目外，记录绝对路径，便于定位。

用户仍可通过 `runtime.baseDir` 显式指定运行时基目录。相对 `runtime.baseDir` 会按 home 展开后解析到用户级路径；不再以项目 cwd 为基准。`runtime.settingsDir` 只能是目录名或相对子路径，例如 `runtime`、`state/srt`。

新增 session 授权空闲过期：

1. 将 `state.sessionAllows` 从 `Set<string>` 改为 `Map<string, { lastUsedAt: number }>`。
2. 新增 `runtime.sessionAllowTtlMs` 配置，默认 30 分钟。
3. 每次 `handleToolCall` 开始时调用清理函数，删除 `now - lastUsedAt > ttl` 的授权。
4. 命中 session 授权时刷新 `lastUsedAt`，实现空闲超时而不是固定创建时间超时。
5. TTL 小于等于 0 时视为禁用 session 授权复用：允许当前调用，但不写入缓存。
6. `/pi-perm use <profile>` 切换 profile 时仍立即清空缓存。

## 数据结构

`runtime` 配置新增字段：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseDir` | string | `~/.pi/agent/extensions/pi-perm` | pi-perm 运行时状态基目录 |
| `settingsDir` | string | `runtime` | SRT settings 子目录，必须是相对路径 |
| `sessionAllowTtlMs` | number | `1800000` | session 授权空闲 TTL，<=0 表示不复用 |

extension state 新增字段：

| 字段 | 说明 |
|------|------|
| `runtimeBaseDir` | 已展开 home 的运行时基目录 |
| `srtSettingsDir` | 已解析的 SRT settings 绝对目录 |
| `now` | 可注入的时间函数，便于测试 TTL |
| `sessionAllows` | `Map<string, { lastUsedAt: number }>` |

## 行为边界

无论默认配置还是用户配置了 `runtime.settingsDir = "runtime"`，SRT settings 都会写入 `runtimeBaseDir/runtime`，不会创建或使用当前项目目录下的 `runtime/`。

如果用户显式配置绝对 `runtime.settingsDir`，或配置会逃出 `runtime.baseDir` 的相对路径，配置校验失败并 fail closed。这避免重新引入“任意位置写 settings”的隐性机制。需要自定义位置时，应配置 `runtime.baseDir`。

本次不删除历史 `runtime/` 目录，避免 extension 对用户项目执行破坏性文件操作。后续用户可手动清理历史目录。

## 风险与兼容

- 依赖旧行为从项目根读取 SRT settings 的外部调试流程需要改为查看用户级 extension 数据目录。
- 绝对 `runtime.settingsDir` 将变为配置错误；这是有意收紧，符合“不保留当前目录 runtime 机制”的目标。
- 如果运行环境没有权限写入用户级 extension 数据目录，SRT settings 写入会失败并阻断对应工具调用，符合 fail-closed 设计。
