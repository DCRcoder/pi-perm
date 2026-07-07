# pi-perm

> English README.
>
> Chinese version: [README.zh-CN.md](README.zh-CN.md)
>
> Project type: Pi Extension Package

`pi-perm` is a Pi extension package that adds configurable permission control for Pi Agent. It intercepts Pi tool calls before execution, applies configured allow, confirm, block, and audit policies, and can wrap `bash` commands with Anthropic Sandbox Runtime through the `srt` command.

## Project Layout

- Extension entry: `index.ts`
- Project config: `config.toml` first, with `config.json` compatibility
- User override config: `~/.pi/agent/extensions/pi-perm/config.toml` first, with JSON compatibility
- SRT runtime settings output: `~/.pi/agent/extensions/pi-perm/runtime/`

This repository follows the Pi package convention: `package.json` declares the extension entry through `pi.extensions: ["./index.ts"]`, so the repository root is the extension package root.

## Install And Configure

Install from the Pi package catalog after the npm package is published. Packages with the `pi-package` keyword can be discovered on <https://pi.dev/packages> after the catalog indexes npm:

```bash
pi install npm:pi-perm
```

For a one-off run from npm without adding it to settings:

```bash
pi -e npm:pi-perm
```

Install directly from GitHub:

```bash
pi install git:github.com/DCRcoder/pi-perm@main
```

For a one-off run from GitHub:

```bash
pi -e git:github.com/DCRcoder/pi-perm@main
```

To enable Sandbox Runtime wrapping, install the `srt` command first:

```bash
npm install -g @anthropic-ai/sandbox-runtime
```

Install from local source:

```bash
git clone git@github.com:DCRcoder/pi-perm.git ~/.pi/agent/extensions/pi-perm
cd ~/.pi/agent/extensions/pi-perm
pnpm install
cp config.example.toml config.toml
```

Pi auto-discovers directory extensions from `~/.pi/agent/extensions/*/index.ts`, and this package declares its entry in `package.json` through `pi.extensions`. Restart Pi, or run `/reload` in an existing Pi session.

For a one-off local test without installing:

```bash
cd /path/to/pi-perm
pnpm install
pi -e ./index.ts
```

Project configuration should use `config.toml`. JSON remains supported for file-format compatibility, but the old `profiles.<name>.sandbox.*` permission model is no longer supported. Filesystem and network permissions must be configured through `permissions.<name>`.

Project config can define permission policies, but high-risk capabilities such as Apple Events, weak sandbox mode, unrestricted Unix sockets, and Docker socket access must be explicitly allowed by user-level config. They cannot be enabled by project config alone.

Runtime files are extension state, not project files. `runtime.settingsDir` is always resolved under `runtime.baseDir` and must be relative; pi-perm does not create or use a `runtime/` directory in the current project for SRT settings.

## Permission Profiles

`activePermissionProfile` selects a named permission profile. A profile combines filesystem and network boundaries, similar to Codex permissions:

```toml
version = 1
activePermissionProfile = "workspace"

[permissions.workspace.filesystem]
":minimal" = "read"

[permissions.workspace.filesystem.":workspace_roots"]
"." = "write"
".git" = "read"
".codex" = "read"
".agents" = "read"
"**/*.env" = "deny"
".env" = "deny"
".env.*" = "deny"
".git/hooks/**" = "deny"

[permissions.workspace.network]
enabled = false
allowLocalBinding = false

[tools.bash]
mode = "enforce"
defaultAction = "allow"
wrapWithSrt = true
srtBinary = "srt"
```

Filesystem access values are `read`, `write`, and `deny`. More specific paths override broader ones; for equal specificity, `deny > write > read`. `:workspace_roots` paths are relative to the current workspace and cannot escape with `..`.

Routine workspace-local commands are allowed inside this boundary. Risky command patterns in `tools.bash.operations`, disabled-network commands, denied paths, and high-risk capabilities still confirm or block.

## Operation Permissions

`tools.bash.operations` controls command-level exceptions before SRT sandbox wrapping. It does not depend on Sandbox Runtime, so it can still confirm or block risky commands when sandbox wrapping is disabled. Typical examples include `rm`, `git push`, `sudo`, remote script execution, credential reads, package publishing, Docker, and cloud or cluster operations.

Example:

```toml
[tools.bash]
wrapWithSrt = true
srtBinary = "srt"

[tools.bash.operations]
preset = "recommended"
block = ["~/.ssh/", "gh auth token", ".git/hooks"]
confirm = ["git push", "git commit", "rm -r", "curl | sh", "kubectl", "terraform", "docker"]

[[tools.bash.operations.advanced]]
id = "confirm-prod-deploy"
category = "deployment"
command = "pnpm"
subcommands = ["deploy:prod"]
action = "confirm"
reason = "Production deploy requires confirmation."
```

Fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `preset` | string | No | Built-in operation rule set. `recommended` is the suggested default. |
| `block` | string[] | No | Original commands or command fragments that must be blocked. Overrides preset actions. |
| `confirm` | string[] | No | Original commands or command fragments that require user confirmation. Overrides preset actions. |
| `allow` | string[] | No | Original commands or command fragments that are allowed directly. Use sparingly; normal workspace-local commands do not need an allowlist. |
| `advanced` | table array | No | Low-level matcher rules for project-specific commands. |

Common patterns:

| Pattern | Meaning |
| --- | --- |
| `rm -r` | Recursive `rm` deletion |
| `git push`, `git commit`, `git reset --hard`, `git clean` | Git write or destructive operations |
| `.git/hooks`, `.gitmodules` | Git hook or submodule persistence risk |
| `sudo`, `su` | Privilege escalation |
| `curl | sh`, `wget | bash`, `eval` | Remote script or dynamic execution |
| `~/.ssh/`, `gh auth token`, `security find-generic-password` | Credential reads |
| `scp`, `rsync`, `sftp`, `nc`, `curl -T` | Network copy or data exfiltration |
| `npm install`, `pnpm install`, `pip install` | Dependency installation |
| `npm publish`, `pnpm publish`, `docker push` | Package or artifact publishing |
| `docker`, `podman` | Container runtime operations |
| `kubectl`, `terraform`, `aws`, `gcloud`, `az` | Cloud or cluster control |
| `open`, `osascript` | System automation |

When original command patterns are not expressive enough, use `advanced` rules. Supported fields include `id`, `category`, `command`, `subcommands`, `argvIncludes`, `commandIncludes`, `commandIncludesAll`, `action`, and `reason`.

## Confirmation Choices

For actions that match `confirm`, pi-perm can offer three choices when the Pi UI supports selectable prompts:

| Choice | Scope |
| --- | --- |
| Deny | Blocks the current tool call. |
| Allow once | Allows only the current tool call. The same command or path asks again next time. |
| Always allow this session | Allows the same profile, tool, rule, and target again for the current Pi session only. The grant is kept in memory and is not written to config. Switching profiles clears session grants. |

If the runtime only supports a boolean `ctx.ui.confirm`, approval is treated as `Allow once`.

While a confirmation choice is waiting for user input, pi-perm asks Pi to show a blocked-style status and working message. If Herdr's Pi integration is installed, pi-perm also emits `herdr:blocked` on Pi's event bus so Herdr can show the agent as blocked. The status is restored when the choice completes. Herdr's `done` label is derived from `idle` plus pane visibility, so pi-perm releases the blocked state instead of emitting a separate done event.

## Pi Commands

- `/pi-perm`: show the current permission profile and policy summary.
- `/pi-perm list`: list configured permission profiles.
- `/pi-perm use <profile>`: switch the permission profile for the current session.
- `/pi-perm audit`: show the audit log path.

`pi_perm_policy` is a read-only tool for querying the current profile and permission summary. It cannot modify config, switch profiles, or elevate permissions.

## Development

```bash
pnpm test
pnpm run typecheck
```
