## Context

当前工作区为空目录，没有既有 Pi extension 代码。Pi 官方 extension 模型允许 TypeScript 模块通过 `pi.on("tool_call")` 拦截工具调用、修改工具入参或返回 `{ block: true }`，也允许通过 `ctx.ui` 发起确认、通知和选择。Anthropic Sandbox Runtime 提供 `srt` CLI 与配置文件，用 OS 级能力限制任意进程的文件系统、网络和 Unix socket 访问。权限控制不能局限于 SRT 的资源隔离；对 `rm`、`git push`、`git reset`、`sudo`、包管理器安装等 agent 操作，也必须能在工具执行前按配置确认或阻断。

用户明确要求所有控制都配置化。因此 extension 的职责是读取配置、校验配置、合并配置、执行策略，而不是在代码里写死具体路径、域名、命令或 profile。项目配置可以声明策略，但用户本地配置必须控制高风险能力的提升，避免仓库内恶意配置自动扩大沙盒权限。

## Goals / Non-Goals

**Goals:**

- 提供一个 Pi extension package，能在 Pi 中拦截工具调用并接入 sandbox-runtime。
- 用配置驱动工具拦截、命令操作审批、权限动作、SRT settings、profile、审计和 UI 提示。
- 对 `bash` 工具先执行命令操作策略，再按配置生成临时 SRT settings，并把原命令改写为 `srt --settings <file> <command>` 形式执行。
- 对文件类工具在执行前进行配置化路径判定，支持 `allow`、`block`、`confirm`、`allowOnce`、`allowSession` 等动作。
- 提供 `/pi-perm` 命令与 `pi_perm_policy` 工具，只能查看或切换已配置 profile，不能让 agent 自行提升权限。
- 提供测试覆盖配置加载合并、命令操作规则判定、策略判定、SRT settings 生成和 bash 改写逻辑。

**Non-Goals:**

- 不修改 Pi agent 内核，不替换 Pi 的工具执行器。
- 不实现 sandbox-runtime 自身的隔离能力，只调用其公开 CLI/config 机制。
- 不保证 Windows 上形成强安全边界；文档中将其标为弱隔离/实验支持。
- 不提供图形化策略编辑器；配置文件是第一版控制面。
- 不允许项目配置自动开启 Apple Events、Docker socket、任意 Unix socket 或弱隔离选项。

## Decisions

### 1. Extension 形态

采用仓库根目录作为 Pi package 根目录，入口为根目录 `index.ts`，并由根目录 `package.json` 的 `pi.extensions: ["./index.ts"]` 声明。项目可以通过 `pi install ./relative/path`、`pi -e ./index.ts` 或 settings 中的 local package path 加载，符合 Pi package 规范。

替代方案是把实现放进消费项目的 `.pi/extensions/` 目录或做独立 CLI。`.pi/extensions/` 更适合消费端项目内配置，不适合作为本仓库源码布局；独立 CLI 无法自然接入 Pi 的 `tool_call`、`ctx.ui` 和 `/pi-perm` 命令。因此根目录 Pi package 更适合首版交付。

### 2. 配置分层与合并

配置源按顺序合并：

1. `defaults/base.json`：仓库内默认配置和示例 profile，只表达安全基线。
2. `config.toml`：package 根目录项目配置，定义 profiles、工具规则、审计和 UI 行为；`config.json` 作为兼容格式。
3. 用户配置路径，默认为 `~/.pi/agent/extensions/pi-perm/config.toml`，对应 Pi global extension 目录规范；`config.json` 作为兼容格式，可通过环境变量 `PI_PERM_USER_CONFIG` 覆盖。

合并规则：

| 字段 | 合并方式 | 说明 |
| --- | --- | --- |
| `profiles` | 按 profile 名覆盖 | 用户配置可新增或覆盖 profile |
| `activeProfile` | 后者覆盖前者 | 启动默认 profile |
| `tools` | 按工具名深合并 | 单个工具策略可独立覆盖 |
| `prompts` | 深合并 | 控制确认文案和默认动作 |
| `audit` | 深合并 | 控制审计文件和输出 |
| `security.userOnlyElevations` | 数组合并去重 | 声明只能从用户配置启用的能力 |

项目配置中的高风险能力如果不在用户配置显式允许列表中，将被降级或拒绝，并写入审计记录。

### 3. 核心配置结构

配置文件以 TOML 为主、JSON 兼容，配置结构由 TypeScript 类型和运行时校验共同维护。

```ts
type SandboxPermissionsConfig = {
  version: 1;
  activeProfile: string;
  profiles: Record<string, SandboxProfile>;
  tools: Record<string, ToolPolicy>;
  prompts?: PromptPolicy;
  audit?: AuditPolicy;
  security?: SecurityPolicy;
};

type SandboxProfile = {
  description?: string;
  sandbox: SrtPolicy;
  toolDefaults?: Partial<ToolPolicy>;
};

type SrtPolicy = {
  network: {
    allowedDomains: string[];
    deniedDomains: string[];
    allowUnixSockets?: string[];
    allowAllUnixSockets?: boolean;
    allowLocalBinding?: boolean;
  };
  filesystem: {
    denyRead: string[];
    allowRead: string[];
    allowWrite: string[];
    denyWrite: string[];
  };
  ignoreViolations?: Record<string, string[]>;
  enableWeakerNestedSandbox?: boolean;
  enableWeakerNetworkIsolation?: boolean;
  allowAppleEvents?: boolean;
};

type ToolPolicy = {
  mode: "off" | "enforce" | "observe";
  defaultAction: "allow" | "block" | "confirm";
  rules?: ToolRule[];
  operations?: OperationPolicy | OperationRule[];
  wrapWithSrt?: boolean;
  srtBinary?: string;
};

type OperationPolicy = {
  preset?: "recommended" | string;
  block?: string[];
  confirm?: string[];
  allow?: string[];
  advanced?: OperationRule[];
};

type ToolRule = {
  id: string;
  match: {
    commandIncludes?: string[];
    pathGlobs?: string[];
    toolNames?: string[];
  };
  action: "allow" | "block" | "confirm";
  reason?: string;
};

type OperationRule = {
  id: string;
  category?: string;
  command?: string | string[];
  subcommands?: string[];
  argvIncludes?: string[];
  commandIncludes?: string[];
  commandIncludesAll?: string[];
  action: "allow" | "block" | "confirm";
  reason?: string;
};
```

### 4. 工具调用处理流程

`pi.on("tool_call")` 处理流程：

1. 读取当前内存配置和 active profile。
2. 根据 `event.toolName` 查找 `tools[event.toolName]`，没有配置时使用 profile 的 `toolDefaults`。
3. `mode = off` 时直接放行；`mode = observe` 时只审计不阻断；`mode = enforce` 时执行规则判定。
4. 对 `bash` 先解析命令文本为保守的 shell operation 摘要，并匹配 `operations`，例如 `rm -rf`、`git push`、`git reset --hard`、`sudo`、`pnpm install`。
5. 命中 `block` 返回 `{ block: true, reason }`。
6. 命中 `confirm` 时调用 `ctx.ui.confirm`；用户拒绝则阻断，用户同意则按配置记录 `allowOnce` 或 session 级授权。
7. 对 `bash` 且 `wrapWithSrt = true` 时，生成当前 profile 对应的临时 SRT settings 文件，将 `event.input.command` 改写为配置中的 `srtBinary` 包装命令。
8. 对文件类工具从入参提取路径，按 `filesystem` 与工具规则判定；路径字段映射由配置的 tool extractor 或内置 schema 配置声明。

### 4.1 命令操作策略

命令操作策略是 Pi 权限层能力，不依赖 sandbox-runtime。默认配置以 `tools.bash.operations` 声明常见高风险操作：

推荐 TOML 写法：

```toml
[tools.bash.operations]
preset = "recommended"
block = ["~/.ssh/", "gh auth token", ".git/hooks"]
confirm = ["git push", "git commit", "rm -r", "curl | sh", "kubectl", "docker"]
allow = ["pnpm install"]

[[tools.bash.operations.advanced]]
id = "confirm-prod-deploy"
category = "deployment"
command = "pnpm"
subcommands = ["deploy:prod"]
action = "confirm"
reason = "Production deploy requires confirmation."
```

Human-friendly 字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `preset` | string | 否 | 内置操作规则集合，首版支持 `recommended` |
| `block` | string[] | 否 | 要阻断的原命令或命令片段，覆盖 preset 动作 |
| `confirm` | string[] | 否 | 要确认的原命令或命令片段，覆盖 preset 动作 |
| `allow` | string[] | 否 | 要放行的原命令或命令片段，覆盖 preset 动作 |
| `advanced` | OperationRule[] | 否 | 特定项目命令的低层匹配规则 |

常用原命令模式：

| 写法 | 说明 |
| --- | --- |
| `rm -r` | 递归删除 |
| `git push` / `git commit` / `git reset --hard` / `git clean` | Git 写入或破坏性操作 |
| `.git/hooks` / `.gitmodules` | Git 持久化风险 |
| `sudo` / `su` | 提权操作 |
| `curl | sh` / `wget | bash` / `eval` | 远程脚本或动态执行 |
| `~/.ssh/` / `gh auth token` | 凭据读取 |
| `scp` / `rsync` / `sftp` / `nc` / `curl -T` | 网络复制或外传 |
| `npm install` / `pnpm install` | 依赖安装 |
| `npm publish` / `pnpm publish` | 包发布 |
| `docker` / `podman` | 容器操作 |
| `kubectl` / `terraform` / `aws` / `gcloud` / `az` | 云和集群控制 |
| `open` / `osascript` | 系统自动化 |

Advanced 字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 稳定规则 ID，用于审计、测试和提示 |
| `category` | string | 否 | 风险分类，例如 `destructive-file`、`git-write`、`credential-access` |
| `command` | string 或 string[] | 否 | 匹配 shell operation 的主命令，例如 `git`、`rm`、`sudo`；省略时只使用 `commandIncludes` |
| `subcommands` | string[] | 否 | 匹配命令后的子命令或关键参数，例如 `push`、`reset`、`--hard` |
| `argvIncludes` | string[] | 否 | 要求 argv 中包含的参数片段，适合 `-rf`、`--delete`、`publish` 等 |
| `commandIncludes` | string[] | 否 | 任一原始命令文本片段命中即匹配，适合 `~/.ssh/`、`.git/hooks`、`gh auth token` |
| `commandIncludesAll` | string[] | 否 | 所有原始命令文本片段都存在才匹配，适合 `curl` 加 `| sh`、`wget` 加 `| bash` |
| `action` | `"allow"` / `"block"` / `"confirm"` | 是 | 命中后的处理动作 |
| `reason` | string | 否 | 给用户和审计日志看的原因 |

| 风险类别 | 示例操作 | 默认动作 | 说明 |
| --- | --- | --- | --- |
| 删除与破坏性文件操作 | `rm -rf`、`find -delete`、`truncate`、`dd`、`shred` | `confirm` | 可能造成不可恢复数据丢失 |
| 权限与所有权修改 | `chmod -R`、`chown -R`、`chflags`、`setfacl` | `confirm` | 可能破坏安全边界或执行权限 |
| Git 写入与状态破坏 | `git push`、`git commit`、`git reset --hard`、`git clean`、`git rebase --continue` | `confirm` | 影响远程仓库或不可逆改变工作区状态 |
| Git 配置与 hooks | `git config`、写 `.git/hooks`、改 `.gitmodules` | `block` 或 `confirm` | 可能持久化恶意命令或改变后续工具行为 |
| 提权与系统控制 | `sudo`、`su`、`launchctl`、`systemctl`、`kill`、`pkill`、`killall` | `confirm` | 影响系统级状态或其他进程 |
| 脚本下载执行链 | `curl ... | sh`、`wget ... | bash`、`bash <(...)`、`eval` | `confirm` | 远程代码直接执行，难以审计 |
| 凭据与敏感信息访问 | `cat ~/.ssh/*`、`security find-generic-password`、`gh auth token` | `block` 或 `confirm` | 可能读取或外传密钥、token、密码 |
| 网络外传与远程复制 | `scp`、`rsync`、`sftp`、`nc`、`curl -T`、`aws s3 cp` | `confirm` | 可能把工作区或凭据传到外部 |
| 依赖安装与供应链变更 | `pnpm install`、`npm install`、`yarn add`、`pip install`、`uv add` | `confirm` | 会执行安装脚本、改 lockfile 或访问网络 |
| 包/镜像/制品发布 | `npm publish`、`pnpm publish`、`docker push`、`gh release create` | `confirm` | 对外发布制品或改变公开状态 |
| 容器与虚拟化控制 | `docker run`、`docker build`、`docker compose up`、访问 Docker socket | `confirm` | 可能绕过宿主隔离或执行高权限进程 |
| 云与集群控制 | `kubectl apply/delete`、`terraform apply/destroy`、`aws iam`、`gcloud`、`az` | `confirm` | 影响外部基础设施和账号资源 |
| 系统应用与自动化 | `open`、`osascript`、Apple Events 相关命令 | `confirm` | 可能启动沙盒外应用或触发系统自动化 |

解析策略必须保守：无法可靠解析复杂 shell 时，继续使用 `commandIncludes` / `commandIncludesAll` 等配置化文本规则兜底；代码不得硬编码具体业务命令白名单。

### 5. SRT settings 生成

SRT settings 只从当前 profile 的 `sandbox` 生成。生成位置默认为 `runtime/<tool-call-id>.srt-settings.json`，可通过配置改到系统临时目录。生成前执行安全校验：

- 项目配置不能单独开启 `allowAppleEvents`、`enableWeakerNestedSandbox`、`enableWeakerNetworkIsolation`、`allowAllUnixSockets`。
- 项目配置不能单独允许 `/var/run/docker.sock` 等高风险 socket。
- `allowWrite` 为空时保持无写权限；不会由代码自动补全业务目录。
- 代码不内置业务域名或路径；默认示例 profile 中的路径只作为配置文件内容存在。

### 6. 命令与工具

`/pi-perm` 命令支持：

- 无参数：显示当前 active profile 和策略摘要。
- `list`：列出配置中的 profiles。
- `use <profile>`：切换到配置中已存在的 profile。
- `audit`：显示最近审计记录路径或摘要。

`pi_perm_policy` 自定义工具只返回当前策略摘要和 profile 列表，不提供写配置或提升权限能力。

### 7. 错误处理与兼容策略

- 配置缺失：加载默认配置并通知用户。
- 配置 schema 错误：extension 进入 fail-closed 模式，阻断受控工具并给出错误位置。
- `srt` 不存在：对需要 SRT 包装的 `bash` 阻断，并提示安装 `@anthropic-ai/sandbox-runtime`。
- 不支持平台：根据配置可进入 `observe`，但默认对 `bash` fail-closed。
- UI 不可用：`confirm` 动作按配置 `prompts.noUiAction` 处理，默认 `block`。

## Risks / Trade-offs

- [Risk] `tool_call` 改写只覆盖 Pi 工具层，无法控制 extension 自身代码访问系统资源。→ Mitigation：extension 只加载可信项目或用户配置，并在文档标明 Pi extension 本身仍以用户权限运行。
- [Risk] Shell 语法复杂，命令操作解析可能漏判。→ Mitigation：实现保守解析并保留配置化 `commandIncludes` 文本规则，默认高风险操作采用确认策略。
- [Risk] 网络 allowlist 只能限制域名，允许宽泛域名仍可能造成数据外传。→ Mitigation：默认网络关闭，文档强调最小域名授权，审计所有网络 profile。
- [Risk] 项目配置可尝试提升高风险能力。→ Mitigation：实现 user-only elevation 校验，只有用户配置显式允许才生效。
- [Risk] Linux/Windows 平台能力差异导致策略行为不同。→ Mitigation：文档列明平台支持，测试覆盖配置生成，不承诺 Windows 强隔离。
- [Risk] shell quoting 错误可能改变命令语义。→ Mitigation：集中实现 `wrapCommandWithSrt` 并测试包含空格、引号和 settings 路径的场景。

## Migration Plan

这是新能力，无既有数据迁移。落地步骤为新增根目录 package 结构、默认配置、示例配置、测试和 README。回滚时移除该 package 或禁用对应 Pi package 配置即可恢复 Pi 默认工具行为。

## Open Questions

无阻塞问题。后续如果 Pi 提供更细粒度的内置权限 API，可以在不改变配置格式的前提下替换执行层。
