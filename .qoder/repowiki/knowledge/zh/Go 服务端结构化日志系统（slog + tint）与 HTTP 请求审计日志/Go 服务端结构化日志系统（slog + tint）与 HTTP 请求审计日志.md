---
kind: logging_system
name: Go 服务端结构化日志系统（slog + tint）与 HTTP 请求审计日志
category: logging_system
scope:
    - '**'
source_files:
    - server/internal/logger/logger.go
    - server/internal/middleware/request_logger.go
    - server/cmd/server/main.go
    - server/cmd/backfill_codex_usage_cache/main.go
    - server/cmd/backfill_issue_last_activity/main.go
    - server/cmd/backfill_task_usage_hourly/main.go
    - server/cmd/backfill_delegated_failure_settled/main.go
    - server/internal/middleware/auth.go
    - server/internal/middleware/daemon_auth.go
---

## 1. 使用的框架与工具

- Go 标准库 `log/slog`：所有后端日志均基于 slog 的键值对结构化输出，不使用第三方日志库。
- `github.com/lmittmann/tint`：作为 slog 的 Handler 实现，提供带 ANSI 颜色的终端输出；当 stderr 重定向到文件时自动关闭颜色。
- `go-chi/chi/v5/middleware`：用于生成 `request_id`、包装 ResponseWriter 以捕获响应体前缀，并配合自定义 RequestLogger 中间件完成访问日志。

## 2. 核心文件与职责

| 文件 | 职责 |
|---|---|
| `server/internal/logger/logger.go` | 全局 slog 初始化、按组件创建命名 logger、写入任意 io.Writer 的 writer logger、从 HTTP request 提取结构化字段 |
| `server/internal/middleware/request_logger.go` | 统一的 HTTP 访问日志中间件，记录 method/path/status/duration/request_id/user_id/client_* 等字段，并对 webhook 路径中的 bearer token 做脱敏 |
| `server/cmd/server/main.go` | 服务入口调用 `logger.Init()` 启动全局日志，并在启动阶段使用 `slog.Error/Warn/Info` 报告配置、数据库连接、Redis 等关键状态 |
| `server/cmd/*/main.go`（backfill_*/migrate） | 独立进程通过 `logger.Init()` 或 `logger.NewWriterLoggerDefault(component, w)` 将日志统一输出到 stderr 或旋转文件 |

## 3. 架构与约定

### 3.1 初始化策略

- **全局默认 logger**：`logger.Init()` 读取环境变量 `LOG_LEVEL`（支持 `debug`、`info`、`warn`/`warning`、`error`，默认 `debug`），构造 tint handler 写入 `os.Stderr`，并通过 `slog.SetDefault` 安装为全局默认。
- **命名 logger**：`logger.NewLogger(component)` 返回附带 `component` 字段的 slog.Logger，供 daemon、migrate 等子进程区分来源。
- **文件输出 logger**：`logger.NewWriterLoggerDefault(component, w)` 将同一 handler 安装到全局默认，使后续裸 `slog.Info(...)` 也落入该 writer（daemon 后台模式把 stderr 重定向到 `daemon.log` 时使用）。
- **TTY 检测**：`isTerminal(os.Stderr)` 决定是否启用 ANSI 颜色；stdout/stderr 重定向到文件时强制 `NoColor: true`，保证日志文件干净可被 logrotate 处理。

### 3.2 结构化字段约定

- **请求级上下文字段**：`request_id`（来自 chi middleware）、`user_id`（`X-User-ID` header）、`client_platform` / `client_version` / `client_os`（通过 `middleware.ClientMetadataFromContext` 注入）。这些字段由 `logger.RequestAttrs(r)` 抽取，handler 在业务日志中通过 `append(logger.RequestAttrs(r), ...)` 复用，确保业务日志与访问日志具备相同的关联维度。
- **Webhook 触发器 ID**：通过 `SetWebhookTriggerID(r, id)` 存入 request context，再由访问日志中间件读取为 `webhook_trigger_id`，避免将 bearer token 直接打印到 URL path。
- **Webhook 路径脱敏**：`redactWebhookPath` 将 `/api/webhooks/autopilots/<token>` 替换为 `[redacted]`，防止成功投递时泄露可重放的凭证 URL。

### 3.3 HTTP 访问日志级别策略

`RequestLogger` 中间件根据响应状态码动态选择 slog 级别：
- `>= 500` → `slog.Error`
- `404` 且响应体包含 `runtime not found` / `task not found` → 降级为 `slog.Info`（称为 softNotFound，属于正常生命周期事件，避免生产 warn 风暴）
- `>= 400` → `slog.Warn`
- 其他 → `slog.Info`

同时跳过 `/health` 端点，避免健康检查污染日志。

### 3.4 进程边界

- **HTTP 服务**（`cmd/server`）：调用 `logger.Init()`，所有 handler/service/middleware 直接使用包级 `slog`。
- **CLI/backfill 进程**：每个入口先 `logger.Init()`，再使用 `slog.*` 输出。
- **Daemon 后台模式**：通过 `StderrIsTerminal()` 判断是否在终端前台运行；若在后台则用 `NewWriterLoggerDefault` 将日志写入 `daemon.log`，否则直接输出到终端。

## 4. 约束与规则

1. **日志级别由单一环境变量控制**：`LOG_LEVEL` 是全局唯一开关，取值限定为 `debug` / `info` / `warn`(或 `warning`) / `error`，默认 `debug`。代码中不存在 per-package 的级别配置。
2. **禁止在日志中输出 webhook bearer token**：访问日志中间件强制对 `/api/webhooks/autopilots/*` 路径进行 `[redacted]` 替换；业务侧应通过 `SetWebhookTriggerID` 将已解析的 trigger ID 放入 context，而不是直接把 token 拼进 message。
3. **业务日志必须携带请求关联字段**：handler 层通过 `append(logger.RequestAttrs(r), ...)` 复用 `request_id`、`user_id`、`client_*` 等字段，使单条业务日志可与同一次请求的访问日志串联。
4. **stderr 始终为 sink**：当前实现未引入独立的日志收集器（如 Loki、CloudWatch），所有日志都写向 stderr（或 daemon 后台模式下的 `daemon.log`），由外部容器/进程管理器负责采集。
5. **前端/客户端未纳入此系统**：`apps/desktop`、`apps/web`、`apps/mobile` 使用原生 `console.log` 或平台日志，不接入 Go 后端的 slog 体系；本卡片仅覆盖 server 端日志。