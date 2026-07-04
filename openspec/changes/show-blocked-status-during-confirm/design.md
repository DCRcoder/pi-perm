## 上下文

Pi extension UI 除了确认弹窗外，还提供工作状态相关 API：

- `ctx.ui.setStatus(key, text | undefined)`
- `ctx.ui.setWorkingMessage(message?)`
- `ctx.ui.setWorkingIndicator(options?)`

当前确认流程只调用 `ctx.ui.select`、`ctx.ui.prompt` 或 `ctx.ui.confirm`。因此在等待用户授权期间，Pi 外层 TUI 仍可能显示普通 working 状态，看起来像 agent 仍在正常执行，而不是被用户输入阻塞。

最新版 Herdr Pi integration 会监听 Pi event bus 上的 `herdr:blocked` 事件。该事件不需要新增文件、终端输出或外部轮询协议；只要 extension 在等待用户输入前后发出 active true/false，Herdr 就能把对应 agent 状态从 idle/working 切换为 blocked 并在结束后恢复。

Herdr 的 `done` 不是 Pi integration 可直接上报的原始状态。Herdr API 的 `PaneAgentState` 只包含 `idle`、`working`、`blocked`、`unknown`；UI 中的 `done` 由 Herdr 在 agent 从 working/blocked 回到 idle 且 pane 尚未被查看时派生。因此 pi-perm 的职责是可靠释放 blocked 状态，让 Herdr 自己进入 idle/done 判定流程，而不是发送 `done`。

## 设计决策

在每次需要弹出权限确认前后增加 UI 状态保护，并可选通知 Herdr Pi integration：

1. 扩展初始化时从 `index.ts` 将 `pi.events` 注入到 `createPiPermExtension({ events })`，避免依赖每次 tool call 的 `ctx` 携带事件总线。
2. 显示确认提示前，如果存在 `events.emit`，发送 `events.emit("herdr:blocked", { active: true, label })`。
3. 通过 `ctx.ui.setStatus("pi-perm", "...")` 设置扩展状态，说明当前正在等待权限确认。
4. 通过 `ctx.ui.setWorkingMessage(...)` 将 working 文案改为 blocked 风格，例如提示正在等待 `pi-perm` 授权。
5. 通过 `ctx.ui.setWorkingIndicator({ frames: ["■"] })` 将 working 指示器切换为静态帧，避免继续呈现普通后台执行的动效。
6. 确认流程结束后，无论用户拒绝、允许一次、允许当前 session、取消或 UI 抛错，都在 `finally` 中恢复默认状态，并发送 `events.emit("herdr:blocked", { active: false, label })`。

所有 UI 状态 API 与 event bus API 必须使用可选调用，保证非交互模式、RPC 模式或旧版本 Pi 中缺少相关 API 时仍能正常执行权限确认。权限决策结果不因 UI 状态展示或 Herdr 事件而改变。

`label` 使用 `pi-perm permission (${toolName}: ${target})`，便于 Herdr 和日志中识别当前阻塞原因。该 label 仅用于展示，不参与授权缓存 key。

不发送 `herdr:done`、`herdr:state` 或 payload `state: "done"`。如果权限确认结束后 Pi agent 本身已经完成，Herdr Pi integration 会在 `agent_end` 后上报 `idle`；Herdr UI 根据 pane 是否已查看决定显示 `done` 还是 `idle`。

## 行为边界

状态保护只在真正需要用户选择时生效。如果工具调用命中当前 session 授权缓存并跳过确认，则不设置 blocked 状态。

Herdr 事件同样只在真正进入用户确认流程时发送。命中 session 授权缓存时不得发送 `active: true`、`active: false` 或任何 done 事件，避免 Herdr 出现无输入等待的状态跳变。

恢复逻辑必须覆盖所有退出路径：

- 用户选择拒绝。
- 用户选择允许一次。
- 用户选择本 session 始终允许。
- 选择器返回空值或取消。
- UI API 抛出异常。

## 风险与兼容

- Pi 最终如何渲染静态 working 指示器由 Pi TUI 决定；本扩展只能通过公开 API 请求 blocked 风格展示。
- Herdr blocked 展示依赖用户已安装支持 `herdr:blocked` 的 Pi integration；未安装或旧版本 integration 时，事件发送会被安全跳过或无人消费。
- Herdr done 展示依赖 Herdr 自身的 pane seen/unseen 逻辑；pi-perm 只能通过释放 blocked 状态确保 Herdr 能继续执行该逻辑。
- 如果其他 extension 同时修改 working message，恢复默认状态可能覆盖对方的临时状态。`setStatus` 使用 `pi-perm` 独立 key，可降低 footer 状态冲突。
