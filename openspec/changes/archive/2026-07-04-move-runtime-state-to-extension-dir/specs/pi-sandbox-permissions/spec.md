## ADDED Requirements

### Requirement: Extension 运行时状态目录
系统 SHALL 将 pi-perm 运行时状态写入 pi-perm extension 数据目录，MUST NOT 默认或通过相对 `runtime.settingsDir` 在当前项目目录创建 `runtime/`。

#### Scenario: 默认 SRT settings 不写入项目目录
- **WHEN** `bash` 工具调用启用 SRT 包装且用户未覆盖运行时目录
- **THEN** 系统将 SRT settings 写入 `~/.pi/agent/extensions/pi-perm/runtime`
- **AND** 系统不得在当前项目目录创建或写入 `runtime/`

#### Scenario: 相对 settingsDir 解析到 extension 数据目录
- **WHEN** 配置设置 `runtime.settingsDir = "runtime"` 或其他相对子目录
- **THEN** 系统将该目录解析为 `runtime.baseDir` 下的子目录
- **AND** 系统不得以当前项目目录为基准解析该路径

#### Scenario: 拒绝绝对 settingsDir
- **WHEN** 配置设置绝对路径形式的 `runtime.settingsDir`
- **THEN** 系统报告配置错误并阻断受控工具
- **AND** 用户需要通过 `runtime.baseDir` 配置运行时基目录

#### Scenario: 拒绝逃出 runtime.baseDir 的 settingsDir
- **WHEN** 配置设置 `runtime.settingsDir = "../outside"` 这类会逃出 `runtime.baseDir` 的相对路径
- **THEN** 系统报告配置错误并阻断受控工具
- **AND** 系统不得在 `runtime.baseDir` 外写入 SRT settings

### Requirement: Session 授权空闲过期
系统 SHALL 为“本 session 始终允许”的授权设置空闲 TTL，并在授权长时间不再使用后自动清理。过期授权 MUST NOT 继续跳过确认。

#### Scenario: 授权在 TTL 内复用
- **WHEN** 用户选择“本 session 始终允许”后，在 `runtime.sessionAllowTtlMs` 内再次触发相同授权 key
- **THEN** 系统跳过确认并刷新该授权的最近使用时间

#### Scenario: 授权空闲超时后重新确认
- **WHEN** 用户选择“本 session 始终允许”后，超过 `runtime.sessionAllowTtlMs` 未再次使用该授权 key
- **THEN** 系统清理该授权
- **AND** 下次相同工具调用必须重新请求用户确认

#### Scenario: 禁用 session 授权复用
- **WHEN** `runtime.sessionAllowTtlMs` 小于或等于 0
- **THEN** 用户选择“本 session 始终允许”只放行当前调用
- **AND** 系统不得写入 session 授权缓存
