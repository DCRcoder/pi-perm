# pi-perm

`pi-perm` 是一个 Pi extension package，用于给 Pi Agent 增加配置化的权限控制能力。它会拦截 Pi 工具调用，在执行前按配置进行确认、阻断、审计，并可将 `bash` 命令包装为 Anthropic Sandbox Runtime 的 `srt` 沙盒命令。

## 目录结构

- Extension 入口：`index.ts`
- 项目配置：优先使用 `config.toml`，兼容 `config.json`
- 用户覆盖配置：优先使用 `~/.pi/agent/extensions/pi-perm/config.toml`，兼容 JSON
- SRT 运行时配置输出：`runtime/`

本项目遵循 Pi package 约定：`package.json` 通过 `pi.extensions: ["./index.ts"]` 声明 extension 入口，因此仓库根目录就是 extension package 根目录。

## 安装与配置

如果需要启用 Sandbox Runtime 包装能力，需要先安装 `srt` 命令：

```bash
npm install -g @anthropic-ai/sandbox-runtime
```

从源码安装：

```bash
git clone <repo-url> ~/.pi/agent/extensions/pi-perm
cd ~/.pi/agent/extensions/pi-perm
pnpm install
cp config.example.toml config.toml
```

Pi 会自动发现 `~/.pi/agent/extensions/*/index.ts` 形式的目录 extension。本项目也在 `package.json` 里通过 `pi.extensions` 声明了入口。安装后重启 Pi，或者在已有 Pi 会话中执行 `/reload`。

如果只是本地临时测试，不需要安装：

```bash
cd /path/to/pi-perm
pnpm install
pi -e ./index.ts
```

项目配置推荐使用 `config.toml`。JSON 仍然保留兼容支持。项目配置可以定义权限策略，但 Apple Events、弱沙盒模式、全部 Unix socket、Docker socket 等高风险能力必须由用户级配置显式授权，不能仅靠项目配置开启。

## 操作权限

`tools.bash.operations` 控制命令级操作权限，发生在 SRT 沙盒包装之前。它不依赖 Sandbox Runtime，因此即使关闭沙盒包装，也可以对 `rm`、`git push`、`sudo`、远程脚本执行、凭据读取、发布、Docker、云资源操作等行为进行确认或阻断。

示例：

```toml
[tools.bash]
wrapWithSrt = true
srtBinary = "srt"

[tools.bash.operations]
preset = "recommended"
block = ["~/.ssh/", "gh auth token", ".git/hooks"]
confirm = ["git push", "git commit", "rm -r", "curl | sh", "kubectl", "terraform", "docker"]
allow = ["pnpm install"]

[[tools.bash.operations.advanced]]
id = "confirm-prod-deploy"
category = "deployment"
command = "pnpm"
subcommands = ["deploy:prod"]
action = "confirm"
reason = "Production deploy requires confirmation."
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `preset` | string | 否 | 内置操作规则集合。推荐使用 `recommended`。 |
| `block` | string[] | 否 | 需要阻断的原命令或命令片段，会覆盖 preset 中的动作。 |
| `confirm` | string[] | 否 | 需要用户确认的原命令或命令片段，会覆盖 preset 中的动作。 |
| `allow` | string[] | 否 | 直接放行的原命令或命令片段，会覆盖 preset 中的动作。 |
| `advanced` | table array | 否 | 低层 matcher 规则，用于项目特有命令。 |

常用写法：

| 写法 | 含义 |
| --- | --- |
| `rm -r` | 带递归参数的 `rm` 删除操作 |
| `git push`, `git commit`, `git reset --hard`, `git clean` | Git 写入或破坏性操作 |
| `.git/hooks`, `.gitmodules` | Git hooks 或 submodule 持久化风险 |
| `sudo`, `su` | 提权操作 |
| `curl | sh`, `wget | bash`, `eval` | 远程脚本或动态执行 |
| `~/.ssh/`, `gh auth token`, `security find-generic-password` | 凭据读取 |
| `scp`, `rsync`, `sftp`, `nc`, `curl -T` | 网络复制或外传 |
| `npm install`, `pnpm install`, `pip install` | 依赖安装 |
| `npm publish`, `pnpm publish`, `docker push` | 发布或推送制品 |
| `docker`, `podman` | 容器运行时操作 |
| `kubectl`, `terraform`, `aws`, `gcloud`, `az` | 云或集群控制 |
| `open`, `osascript` | 系统自动化 |

当原命令模式不够用时，可以使用 `advanced` 规则。可用字段包括：`id`、`category`、`command`、`subcommands`、`argvIncludes`、`commandIncludes`、`commandIncludesAll`、`action` 和 `reason`。

## Pi 命令

- `/pi-perm`：查看当前 profile 和策略摘要。
- `/pi-perm list`：列出已配置的 profiles。
- `/pi-perm use <profile>`：切换当前会话使用的 profile。
- `/pi-perm audit`：查看审计日志路径。

`pi_perm_policy` 是只读工具，用于让 agent 查询当前 profile 和权限摘要。它不能修改配置、切换 profile 或提升权限。

## 开发验证

```bash
pnpm test
pnpm run typecheck
```
