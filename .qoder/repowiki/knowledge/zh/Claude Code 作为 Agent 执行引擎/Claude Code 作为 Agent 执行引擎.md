---
kind: external_dependency
name: Claude Code 作为 Agent 执行引擎
slug: claude-code
category: external_dependency
category_hints:
    - vendor_identity
    - framework_behavior
    - client_constraint
scope:
    - '**'
source_files:
    - server/pkg/agent/claude.go
    - server/internal/daemon/execenv/context.go
    - server/internal/daemon/execenv/runtime_config_sections.go
---

### 角色与集成点
- Multica 不自行实现 Agent，而是通过本地守护进程 spawn 本机 `claude` CLI，以 stream-json 协议（`--output-format stream-json --input-format stream-json`）驱动，权限模式为 `bypassPermissions`，并禁用 `AskUserQuestion`。
- 启动参数固定注入 `--model` / `--effort`、可选的 `--strict-mcp-config`，环境变量剥离 `CLAUDECODE_*` 内部标记并注入任务级 `MULTICA_*` token。

### 关键行为约束
- **无交互无人值守**：所有工具调用自动放行，后台运行请求被强制改回 `run_in_background=false`。
- **追问走评论**：平台没有 UI 渲染用户提问，因此把追问语义转为 issue 评论回复。
- **SystemPrompt 留空**：Daemon 故意不传 SystemPrompt，因为 brief 已写入 `{workDir}/CLAUDE.md`（Claude 原生记忆文件），由 Claude Code 自身读取。

### 技能装配与渐进式加载
- 技能 A/B 不是拼进 prompt，而是完整水合到 `{workDir}/.claude/skills/{slug}/SKILL.md` + scripts/references，交给 Claude Code 原生扫描发现。
- 渐进式披露：仅 frontmatter 的 name+description 常驻上下文；正文与支撑文件在模型判断相关后才进入上下文；可通过 frontmatter `disable-model-invocation: true` 让技能"在盘上但不主动曝光"。
- 传输层按 SHA256 内容寻址缓存，内容不变时不重复落盘。

### 验证提示
- 确认具体 `--model`/`--effort` 取值来源与 MCP 配置格式，需对照 Claude Code 官方文档。