---
kind: error_handling
name: Go 服务端错误处理体系：结构化响应、HTTP 状态码与任务失败分类
category: error_handling
scope:
    - '**'
source_files:
    - server/internal/handler/handler.go
    - server/internal/middleware/request_logger.go
    - server/pkg/taskfailure/failure.go
    - server/pkg/taskfailure/classify.go
    - server/internal/handler/auth.go
    - server/internal/handler/seat_capacity.go
    - server/internal/handler/wecom_web.go
---

## 1. 整体方法

Multica 的 Go 后端采用「集中式 HTTP 响应封装 + 领域级错误码 + 任务失败分类」三层架构：
- handler 层通过 `writeJSON` / `writeError` / `writeErrorCode` 统一写入 JSON 响应体，所有错误响应都包含 `error` 字段，业务错误额外带稳定 `code` 字段，供 UI 做机器可读翻译。
- 中间件层（`internal/middleware/request_logger.go`）用 `chi/middleware.NewWrapResponseWriter` 捕获响应状态码和少量 body，按 5xx/4xx/200 分级记录到 `slog`，并对 webhook 路径中的 bearer token 做 `[redacted]` 脱敏。
- 任务执行层（`server/pkg/taskfailure`）把 agent 进程返回的自由文本错误归一化为 26 个稳定的 `Reason`（平台侧 + 14 个 `agent_error.*` 子原因），用于持久化到 `agent_task_queue.failure_reason` 并驱动重试/恢复策略。

## 2. 关键文件与包

| 层次 | 关键路径 | 职责 |
|---|---|---|
| HTTP 响应封装 | `server/internal/handler/handler.go` | `writeJSON`、`writeMeasuredJSON`、`writeError`、`writeErrorCode`、`writeRevisionConflict`、`writeEditConflict` |
| 请求日志/错误观测 | `server/internal/middleware/request_logger.go` | 结构化请求日志、404 软标记识别、webhook 路径脱敏 |
| 数据库错误映射 | `server/internal/handler/handler.go` | `isNotFound`、`isUniqueViolation`、`isCheckViolation`（基于 `pgx.ErrNoRows` / `pgconn.PgError`） |
| 任务失败分类 | `server/pkg/taskfailure/failure.go` | 26 个 `Reason` 常量（平台侧 12 个 + agent_error.* 14 个 + unknown） |
| 失败分类器 | `server/pkg/taskfailure/classify.go` | `Classify(rawError)` 字符串匹配规则；`NormalizeDaemonReason` 兼容旧 daemon 标签 |
| 业务错误码 | `server/internal/handler/auth.go`、`seat_capacity.go`、`wecom_web.go` 等 | 调用 `writeErrorCode` 输出如 `googleLoginCodeAccountDisabled`、`seat_capacity_full` 等稳定 code |

## 3. 架构与约定

### 3.1 HTTP 错误响应格式
所有 handler 必须通过 `handler.go` 中的辅助函数写响应，禁止直接 `json.Marshal` + `WriteHeader`。约定如下：
- 成功响应：`writeJSON(w, 200, data)`，自动设置 `Content-Type: application/json`、精确 `Content-Length`，并在末尾追加换行以兼容历史行为。
- 通用错误：`writeError(w, status, "message")` → `{"error": "..."}`。
- 机器可读错误：`writeErrorCode(w, status, code, msg)` → `{"error": "...", "code": "..."}`，UI 据此显示本地化文案而非直译英文消息。
- 乐观锁冲突：`writeRevisionConflict` / `writeEditConflict` 返回 409，附带 `resource_type`、`resource_id`、`expected_revision`/`actual_revision`。

### 3.2 输入校验与 panic 边界
- UUID 解析分两种：`parseUUID`（内部 trusted 值，非法时 panic，由 chi 的 `middleware.Recoverer` 转为 500）和 `parseUUIDOrBadRequest`（用户输入，非法时写 400）。注释明确禁止对未验证的用户输入使用前者，因为零 UUID 曾导致静默数据丢失（#1661）。
- 认证缺失统一走 `requireUserID` → 401 + `user not authenticated`。
- 工作区成员/角色校验走 `requireWorkspaceMember` / `requireWorkspaceRole`，分别返回 404 或 403。

### 3.3 数据库错误到 HTTP 状态的映射
handler 层提供三个判定函数，将底层 `pgx` / `pgconn` 错误映射为语义化 HTTP 状态码：
- `isNotFound(err)`：`errors.Is(err, pgx.ErrNoRows)` → 404。
- `isUniqueViolation(err)`：`pgErr.Code == "23505"` → 409（唯一约束冲突）。
- `isCheckViolation(err)`：`pgErr.Code == "23514"` → 4xx（CHECK 约束失败）。
这些函数被各 handler 在调用 service/db 后使用，避免把 SQLSTATE 泄漏给客户端。

### 3.4 任务失败分类体系（taskfailure）
`pkg/taskfailure` 是跨 server/daemon/cloud 共享的唯一失败原因来源，写入 `agent_task_queue.failure_reason` 与 `chat_message.failure_reason`。
- **平台侧原因**（无前缀）：`queued_expired`、`runtime_offline`、`runtime_reconnect_timeout`、`runtime_recovery`、`timeout`、`iteration_limit`、`agent_blocked`、`api_invalid_request`、`skill_bundle_unavailable`、`runtime_cli_timeout`、`environment_prepare_failed`、`invalid_task_identity`。
- **Agent 侧原因**（`agent_error.*` 前缀）：14 个子类，覆盖 provider auth/quota/capacity/server/network、process failure、context overflow、missing config、model not found、runtime version/executable 问题以及 catchall `agent_error.unknown`。
- `Classify(rawError string) Reason` 通过预编译正则（`providerHTTP5xxRe`、`httpAuthCodeRe` 等）+ 子串匹配，将自由文本错误归一化；规则顺序遵循“更具体优先”原则，与 MUL-1949 离线回填 SQL 保持同步。
- `NormalizeDaemonReason(reason, rawError)` 作为兼容性 shim，把旧 daemon 产出的过时标签升级为当前 taxonomy，确保新旧版本混部时的可观测性一致。
- `AllReasons()` 返回稳定排序列表，供 Prometheus 预冷 label 集合。

### 3.5 中间件错误观测
`RequestLogger` 使用 `chimw.NewWrapResponseWriter` 包装 `ResponseWriter`，在 `ServeHTTP` 结束后读取 `ww.Status()`，并按以下规则分级记录：
- 5xx → `slog.Error`
- 404 且 body 命中 `softNotFoundMarkers`（`runtime not found`、`task not found`）→ `slog.Info`（生命周期预期信号，不告警）
- 其他 4xx → `slog.Warn`
- 2xx → `slog.Info`
同时记录 method、path（webhook 路径中的 bearer token 段替换为 `[redacted]`）、status、duration、request_id、user_id、client_platform/version/os 等结构化字段。

## 4. 约定与约束

| 约定 | 说明 | 证据 |
|---|---|---|
| 所有 HTTP 响应经 `writeJSON`/`writeError`/`writeErrorCode` | 保证 Content-Type、Content-Length、尾部换行一致 | `handler.go:524-573` |
| 业务错误必须带稳定 `code` 字段 | 供 UI 做机器可读翻译，而非直译英文 message | `handler.go:567-573` 注释 |
| 用户输入的 UUID 必须用 `parseUUIDOrBadRequest` | 防止零 UUID 静默写入数据库 | `handler.go:595-668` 注释 |
| 数据库错误必须经 `isNotFound/isUniqueViolation/isCheckViolation` 判断 | 禁止直接把 `pgconn.PgError` 暴露给客户端 | `handler.go:796-811` |
| 任务失败原因必须来自 `taskfailure.Reason` 常量 | 禁止手写字符串，保证 wire 稳定性 | `failure.go:45-49` 注释 |
| 新增 `agent_error.*` 原因需配套 SQL 回填规则 | 因 wire 形式持久化到 DB 并作为 Prometheus label | `failure.go:36-40` 注释 |
| 404 中 `runtime not found` / `task not found` 视为正常生命周期信号 | 不记 Warn，避免删除运行时产生日志风暴 | `request_logger.go:102-111` |
| Webhook 路径中的 bearer token 必须脱敏 | 防止成功交付 URL 泄露可重放凭证 | `request_logger.go:44-70` |
| 认证/权限失败统一返回 401/403 + 固定 message | 通过 `requireUserID` / `roleAllowed` 集中处理 | `handler.go:879-990` |

## 5. 前端/移动端侧的错误处理（简要）

- Web/Desktop（Next.js + Electron）通过 `@multica/core` 的 API/WS 客户端消费后端返回的 `{error, code}` 结构，由 UI 层根据 `code` 选择提示文案。
- Mobile（Expo/React Native）仅依赖 `@multica/core` 的类型与纯函数，不直接处理 HTTP 错误；网络层异常由 React Query / Expo 网络栈向上抛出，再由页面组件消费。
- 该仓库未定义统一的 `Error` 类型或全局 error boundary，错误处理集中在服务端响应结构与前端各自页面的 try/catch + toast。

## 6. 总结

Multica 的错误处理以「handler 层统一 JSON 响应 + 中间件结构化日志 + taskfailure 统一失败分类」为核心，强调：
1. 对外只暴露稳定的 `code` 字符串，不暴露内部堆栈或 SQLSTATE；
2. 数据库错误通过 pgx/pgconn 类型断言映射为语义化 HTTP 状态码；
3. 任务失败原因收敛到 26 个 `Reason` 常量，驱动重试/恢复/可观测性；
4. 日志层对敏感信息（webhook token）脱敏，对预期 404 降噪。
