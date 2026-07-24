## MODIFIED Requirements

### Requirement: Session 级确认授权
系统 SHALL 在确认提示中支持“允许一次”和 session 级授权。session 级授权 MUST 只在当前 extension 实例生命周期内生效，MUST NOT 写入配置或跨 session 持久化。session 级授权 SHALL 按 active profile、工具名、规则 ID 或操作 ID、授权范围和目标摘要限制复用范围。对于结构化文件工具的外部写入确认，系统 SHALL 支持文件级 session 授权和文件夹级 session 授权。

#### Scenario: 用户选择允许一次
- **WHEN** 工具调用命中 `confirm` 规则且用户选择“允许一次”
- **THEN** 系统放行当前调用，不写入 session 授权缓存，并在下一次命中同一规则和目标时再次请求确认

#### Scenario: 用户选择本 session 始终允许
- **WHEN** 非外部文件写入工具调用命中 `confirm` 规则且用户选择“本 session 始终允许”
- **THEN** 系统放行当前调用，并按 active profile、`toolName`、规则 ID 或操作 ID、目标摘要记录当前 session 授权 key

#### Scenario: 用户选择文件级 session 授权
- **WHEN** 工具调用命中 `confirm` 规则且用户选择“本 session 始终允许当前文件”
- **THEN** 系统放行当前调用，并按 active profile、`toolName`、规则 ID 或操作 ID、文件级授权范围和目标摘要记录当前 session 授权 key

#### Scenario: 用户选择文件夹级 session 授权
- **WHEN** `write` 或 `edit` 工具命中外部写入确认规则且用户选择“本 session 始终允许当前文件夹”
- **THEN** 系统放行当前调用，并按 active profile、`toolName`、规则 ID、文件夹级授权范围和目标所在文件夹摘要记录当前 session 授权 key

#### Scenario: 同一 session 内重复命中已授权目标
- **WHEN** 后续工具调用命中相同的 session 授权 key
- **THEN** 系统不再请求用户确认，直接放行该调用，并记录 session 授权命中审计

#### Scenario: 不同命令或路径仍需确认
- **WHEN** 用户已对一个命令或路径选择“本 session 始终允许”
- **THEN** 系统不得将该授权用于不同规则 ID、不同操作 ID 或不同目标摘要的工具调用

#### Scenario: 外部写入文件级授权不扩大到其他路径
- **WHEN** 用户对一个外部 `write` 或 `edit` 目标选择“本 session 始终允许当前文件”
- **THEN** 系统只对相同 active profile、相同工具、相同外部目标摘要复用授权
- **AND** 系统不得将该授权用于其他外部文件、目录或不同目标组合

#### Scenario: 外部写入文件夹级授权复用同一文件夹
- **WHEN** 用户对一个外部 `write` 或 `edit` 目标选择“本 session 始终允许当前文件夹”
- **AND** 后续 `write` 或 `edit` 工具访问同一文件夹下另一个未被当前 permission profile 明确允许且未被 deny 的路径
- **THEN** 系统不再请求用户确认，直接放行该调用
- **AND** 系统记录文件夹级 session 授权命中审计

#### Scenario: 外部写入文件夹级授权不跨文件夹
- **WHEN** 用户已对一个外部文件夹选择“本 session 始终允许当前文件夹”
- **AND** 后续 `write` 或 `edit` 工具访问另一个文件夹下的外部路径
- **THEN** 系统不得复用原文件夹授权，必须重新请求确认

#### Scenario: 切换 profile 后授权失效
- **WHEN** 用户已对一个工具调用选择“本 session 始终允许”后执行 `/pi-perm use <profile>` 切换到另一个 profile
- **THEN** 系统清空当前 session 授权缓存，后续同名工具、规则和目标仍需重新确认

#### Scenario: UI 只支持布尔确认
- **WHEN** 运行环境只提供 `ctx.ui.confirm` 而不支持选项式确认
- **THEN** 系统保持兼容，用户确认成功只视为“允许一次”，不得写入 session 授权缓存

### Requirement: 文件工具权限判定
系统 SHALL 在配置启用时拦截文件类工具，并根据当前 effective permission profile 的路径规则决定允许、阻断或确认。对于 `write` 和 `edit` 工具，未被当前 permission profile 明确允许且未被 deny 的路径 SHALL 触发用户确认，即使工具默认动作配置为 `allow`。

#### Scenario: 写入允许路径
- **WHEN** `write` 或 `edit` 工具访问当前 permission profile 中 `write` 允许的 workspace 路径
- **THEN** 系统允许该工具调用
- **AND** 系统不得为普通 workspace 写入请求确认

#### Scenario: 写入被拒绝路径
- **WHEN** `write` 或 `edit` 工具尝试访问配置中拒绝的路径
- **THEN** 系统在工具执行前阻断调用，并返回配置化的拒绝原因

#### Scenario: 读取只读路径
- **WHEN** `read` 工具访问当前 permission profile 中 `read` 允许但未允许写入的路径
- **THEN** 系统允许读取
- **AND** 写入同一路径仍不得自动允许

#### Scenario: 需要用户确认的边界外路径
- **WHEN** 文件工具访问未被当前 permission profile 明确允许且未被 deny 的路径
- **THEN** 系统通过 `ctx.ui.confirm` 请求用户确认，并根据用户选择允许或阻断该次调用

#### Scenario: 外部写入路径需要用户确认
- **WHEN** `write` 或 `edit` 工具访问当前 workspace 外部路径，且该路径未被当前 permission profile 明确允许或 deny
- **THEN** 系统在工具执行前请求用户确认
- **AND** 用户可以选择拒绝、允许一次、本 session 始终允许当前文件或本 session 始终允许当前文件夹

#### Scenario: 外部写入确认不受工具默认 allow 影响
- **WHEN** `tools.write.defaultAction` 或 `tools.edit.defaultAction` 配置为 `allow`
- **AND** `write` 或 `edit` 工具访问未被当前 permission profile 明确允许且未被 deny 的外部路径
- **THEN** 系统仍然请求用户确认，不得因工具默认 allow 自动放行

#### Scenario: Deny 优先于外部写入确认
- **WHEN** `write` 或 `edit` 工具访问命中当前 permission profile `deny` 规则的路径
- **THEN** 系统直接阻断该工具调用
- **AND** 系统不得显示允许一次或本 session 始终允许的确认选项
