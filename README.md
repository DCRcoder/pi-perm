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
- SRT runtime settings output: `runtime/`

This repository follows the Pi package convention: `package.json` declares the extension entry through `pi.extensions: ["./index.ts"]`, so the repository root is the extension package root.

## Install And Configure

To enable Sandbox Runtime wrapping, install the `srt` command first:

```bash
npm install -g @anthropic-ai/sandbox-runtime
```

Install from source:

```bash
git clone <repo-url> ~/.pi/agent/extensions/pi-perm
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

Project configuration should use `config.toml`. JSON remains supported for compatibility. Project config can define permission policies, but high-risk capabilities such as Apple Events, weak sandbox mode, unrestricted Unix sockets, and Docker socket access must be explicitly allowed by user-level config. They cannot be enabled by project config alone.

## Operation Permissions

`tools.bash.operations` controls command-level operation permissions before SRT sandbox wrapping. It does not depend on Sandbox Runtime, so it can still confirm or block risky commands when sandbox wrapping is disabled. Typical examples include `rm`, `git push`, `sudo`, remote script execution, credential reads, package publishing, Docker, and cloud or cluster operations.

Example:

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

Fields:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `preset` | string | No | Built-in operation rule set. `recommended` is the suggested default. |
| `block` | string[] | No | Original commands or command fragments that must be blocked. Overrides preset actions. |
| `confirm` | string[] | No | Original commands or command fragments that require user confirmation. Overrides preset actions. |
| `allow` | string[] | No | Original commands or command fragments that are allowed directly. Overrides preset actions. |
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

## Pi Commands

- `/pi-perm`: show the current profile and policy summary.
- `/pi-perm list`: list configured profiles.
- `/pi-perm use <profile>`: switch the profile for the current session.
- `/pi-perm audit`: show the audit log path.

`pi_perm_policy` is a read-only tool for querying the current profile and permission summary. It cannot modify config, switch profiles, or elevate permissions.

## Development

```bash
pnpm test
pnpm run typecheck
```
