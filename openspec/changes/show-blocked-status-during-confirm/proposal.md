## 背景

当 `pi-perm` 因 `confirm` 规则等待用户授权时，Pi 仍然显示默认 working 状态。对于 herdr / Codex 这类终端开发流程，等待用户授权意味着 agent 当前无法继续推进，前端通常会显示为 blocked 状态。

## 目标

- 在 `pi-perm` 等待用户确认期间，显示类似 blocked 的 UI 状态。
- 用户选择拒绝、允许一次或本 session 始终允许后，恢复 Pi 默认 working 状态。
- 使用 Pi extension 已公开的 UI API 显示 blocked 风格状态。
- 当运行环境安装了 Herdr Pi integration 时，通过 Pi event bus 发出 Herdr 已约定的 blocked 事件，让 Herdr 可显示 blocked 状态，并在确认结束后回到 Herdr 的 idle/done 判定流程。

## 非目标

- 不改变权限策略判定结果。
- 不持久化 blocked 状态。
- 不新增 herdr 专用状态文件、终端输出协议或其他外部协议。
- 不直接上报 Herdr `done`。Herdr 的 `done` 是 `idle + unseen` 的 UI 注意状态，不是 Pi integration 的原始 agent state。
