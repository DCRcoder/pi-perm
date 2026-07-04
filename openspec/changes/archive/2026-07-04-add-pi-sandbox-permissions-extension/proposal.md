## Why

Pi agent 的内置工具可以执行命令、读取文件和写入文件；仅靠提示词或人工确认无法约束子进程实际访问的文件、网络和 Unix socket。需要一个基于 Pi extension 的沙盒与权限管理能力，把 Anthropic Sandbox Runtime 的 OS 级隔离接入 Pi，并让所有控制规则通过配置声明。

## What Changes

- 新增 Pi extension package，仓库根目录就是 package 根目录，通过 `package.json` 的 `pi.extensions` 声明 `./index.ts`。
- 接入 `@anthropic-ai/sandbox-runtime` 的 `srt` CLI，对 `bash` 工具调用进行可配置的沙盒包装。
- 拦截 Pi 内置工具调用，并按配置化规则处理 `bash`、`read`、`write`、`edit` 等工具的权限判定。
- 新增命令级操作权限策略，不依赖 sandbox-runtime 能力即可对 `rm`、`git`、`sudo`、包管理器安装、远程推送等操作执行确认或阻断。
- 配置格式以 TOML 为主，保留 JSON 兼容；命令操作权限支持 human-friendly 的原命令模式、preset、confirm/block/allow 写法。
- 新增配置加载、校验、合并、profile 切换、临时 SRT settings 生成和审计记录能力。
- 新增 `/pi-perm` 命令和 `pi_perm_policy` 工具，用于查看当前策略、切换配置中已有 profile、输出权限摘要。
- 所有可变控制项必须来自配置；代码不得硬编码具体业务路径、网络域名、命令白名单或工具策略。
- 不引入破坏性变更；这是一个新仓库中的新 extension 能力。

## Capabilities

### New Capabilities

- `pi-sandbox-permissions`: 定义 Pi agent 权限 extension 的配置化策略、工具拦截、命令操作审批、SRT 包装、用户确认和审计行为。

### Modified Capabilities

无。

## Impact

- 新增根目录 extension 源码、配置示例和运行说明。
- 新增 `package.json`、TypeScript 配置和测试框架。
- 新增对 `@anthropic-ai/sandbox-runtime`、`@earendil-works/pi-coding-agent`、`typebox` 等运行/类型依赖。
- 运行时依赖本机可用的 `srt` 命令；macOS 依赖 sandbox-runtime 支持的 `sandbox-exec`，Linux 依赖 bubblewrap 相关环境，Windows 仅作为弱隔离实验平台说明。
