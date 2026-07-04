## ADDED Requirements

### Requirement: 确认等待期间显示 blocked 状态
系统 SHALL 在等待用户处理 `confirm` 权限提示期间，显示 blocked 风格的 UI 状态，表明 agent 当前被用户授权输入阻塞。

#### Scenario: 显示等待授权状态
- **WHEN** 工具调用需要用户确认且没有命中当前 session 授权缓存
- **THEN** 系统在展示确认提示前设置 `pi-perm` 状态和 working 文案，说明当前正在等待权限确认

#### Scenario: 通知 Herdr 进入 blocked 状态
- **WHEN** 工具调用需要用户确认且扩展运行环境提供 Pi event bus
- **THEN** 系统在展示确认提示前发送 `herdr:blocked` 事件，payload 包含 `active: true` 和当前授权等待说明

#### Scenario: 用户选择后恢复状态
- **WHEN** 用户选择拒绝、允许一次或本 session 始终允许
- **THEN** 系统在确认提示结束后恢复默认 working 状态

#### Scenario: 通知 Herdr 退出 blocked 状态
- **WHEN** 用户选择拒绝、允许一次、本 session 始终允许，或确认 UI 异常结束
- **THEN** 系统发送 `herdr:blocked` 事件，payload 包含 `active: false` 和同一个授权等待说明

#### Scenario: Herdr done 由 idle/unseen 派生
- **WHEN** 权限确认结束后 Herdr 需要显示完成态
- **THEN** 系统不发送 `done` 状态事件，而是释放 blocked 状态，让 Herdr 根据 idle 和 pane seen 状态自行显示 done 或 idle

#### Scenario: UI 异常后恢复状态
- **WHEN** 确认提示抛出异常或被取消
- **THEN** 系统在返回或继续抛出结果前恢复默认 working 状态

#### Scenario: Session 授权命中不显示 blocked 状态
- **WHEN** 工具调用因当前 session 授权缓存而跳过确认
- **THEN** 系统不设置 blocked 风格等待状态，也不发送 Herdr blocked 或 done 事件，因为此时没有等待用户输入
