## MODIFIED Requirements

### Requirement: 审计记录
系统 SHALL 按配置记录权限判定、用户确认结果、策略降级、SRT settings 生成和阻断原因。审计文件 MUST 写入 pi-perm extension 数据目录（`runtime.baseDir`）下，不得在当前项目目录创建任何审计文件。

#### Scenario: 工具调用被阻断
- **WHEN** 任一受控工具调用被策略阻断
- **THEN** 系统记录工具名、规则 ID、动作、原因和时间

#### Scenario: 命令操作命中规则
- **WHEN** `bash` 调用命中命令操作权限规则
- **THEN** 系统记录命令操作、规则 ID、动作、原因和时间

#### Scenario: 用户确认授权
- **WHEN** 用户通过确认提示允许一次或 session 级调用
- **THEN** 系统记录授权范围、来源和过期条件

#### Scenario: Session 授权命中
- **WHEN** 工具调用因当前 session 授权缓存而跳过确认
- **THEN** 系统记录命中的授权 key、工具名、目标摘要和时间

#### Scenario: 审计文件位于 extension 数据目录
- **WHEN** `audit.enabled = true` 且未指定 `audit.file`
- **THEN** 系统把审计文件写入 `runtime.baseDir/audit.jsonl`，不创建项目目录的 `audit.jsonl`

#### Scenario: 审计文件路径来自配置
- **WHEN** 用户设置 `audit.file = "logs/perm.jsonl"`
- **THEN** 系统把审计文件写入 `runtime.baseDir/logs/perm.jsonl`，自动创建父目录

#### Scenario: 拒绝绝对 audit.file
- **WHEN** 用户设置 `audit.file = "/var/log/audit.jsonl"`
- **THEN** 加载阶段抛出错误，fail-closed 阻断受控工具

#### Scenario: 拒绝逃出 runtime.baseDir 的 audit.file
- **WHEN** 用户设置 `audit.file = "../escape.jsonl"`
- **THEN** 加载阶段抛出错误，fail-closed 阻断受控工具

#### Scenario: 禁用 audit
- **WHEN** `audit.enabled = false`
- **THEN** 系统不创建任何审计文件
