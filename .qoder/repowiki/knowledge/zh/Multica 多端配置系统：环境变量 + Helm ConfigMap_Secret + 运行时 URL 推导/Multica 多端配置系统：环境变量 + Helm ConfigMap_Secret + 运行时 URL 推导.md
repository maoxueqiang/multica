---
kind: configuration_system
name: Multica 多端配置系统：环境变量 + Helm ConfigMap/Secret + 运行时 URL 推导
category: configuration_system
scope:
    - '**'
source_files:
    - .env.example
    - server/internal/daemon/config.go
    - server/pkg/featureflag/config.go
    - apps/web/config/runtime-urls.ts
    - apps/web/next.config.ts
    - apps/desktop/.env.development.local
    - apps/mobile/.env.example
    - apps/mobile/app.config.ts
    - deploy/helm/multica/values.yaml
    - deploy/helm/multica/templates/configmap.yaml
    - deploy/helm/multica/templates/backend.yaml
---

## 1. 总体方案

Multica 是一个 Go 后端 + Next.js Web/Electron Desktop + Expo Mobile 的 Monorepo，配置系统围绕「环境变量为唯一事实来源」构建，通过不同载体注入到各进程：

- **Go 后端**（server）：启动时直接 `os.Getenv` 读取 `MULTICA_*`、`DATABASE_URL`、`JWT_SECRET`、`SMTP_*`、`S3_*`、`CORS_ALLOWED_ORIGINS`、`POSTHOG_*` 等数十个环境变量；可选从 `MULTICA_FEATURE_FLAGS_FILE` 指向的 YAML 文件加载特性开关规则。
- **Kubernetes/Helm**：`deploy/helm/multica/values.yaml` 是部署参数源，`templates/configmap.yaml` 把非敏感值映射为 `ConfigMap` 中的环境变量，`existingSecret`（由运维在集群外创建）提供 `JWT_SECRET`、`POSTGRES_PASSWORD`、`RESEND_API_KEY` 等密钥，两者经 `envFrom` 注入后端 Pod。
- **Next.js Web**：`next.config.ts` 在构建期读取根 `.env`，并通过 `apps/web/config/runtime-urls.ts` 解析 `NEXT_PUBLIC_API_URL` / `REMOTE_API_URL` / `DOCS_URL` 来决定 dev/prod 下的 rewrite 目标；浏览器侧再按 `NEXT_PUBLIC_WS_URL` 或从 API base 派生 `/ws`。
- **Electron Desktop**：使用 Vite 变量 `VITE_API_URL` / `VITE_WS_URL`，由 `scripts/dev-env.sh` 写入 `apps/desktop/.env.development.local`。
- **Expo Mobile**：通过 `EXPO_PUBLIC_*` 变量（如 `EXPO_PUBLIC_API_URL`），Metro 在启动时内联进 JS bundle；Release 构建时固化到二进制中，只能重新构建变更。

## 2. 关键文件与包

| 层级 | 文件/包 | 作用 |
|---|---|---|
| 后端入口 | `server/internal/daemon/config.go` | `LoadConfig(Overrides)` 统一解析 daemon 相关的环境变量（`MULTICA_DAEMON_*`、`MULTICA_AGENT_*`、`MULTICA_GC_*`、`MULTICA_CODEX_*` 等），并支持 CLI flag 覆盖 env、env 覆盖默认值 |
| 特性开关 | `server/pkg/featureflag/config.go` | 从 `MULTICA_FEATURE_FLAGS_FILE` 读 YAML，再以 `FF_<KEY>` 环境变量覆盖，构成链式 Provider |
| 前端 URL 推导 | `apps/web/config/runtime-urls.ts` | 清洗/校验 `NEXT_PUBLIC_API_URL`、`REMOTE_API_URL`、`NEXT_PUBLIC_WS_URL`，导出 dev/prod 两套解析器 |
| Next 配置 | `apps/web/next.config.ts` | 构建期加载根 `.env`，根据 `NODE_ENV` 选择 dev/prod URL 解析器，设置 `/api`、`/v1`、`/ws`、`/auth`、`/uploads`、`/docs` rewrite |
| Helm values | `deploy/helm/multica/values.yaml` | 定义 images、postgres、backend.config、frontend.config、ingress 等所有可覆写参数 |
| Helm ConfigMap | `deploy/helm/multica/templates/configmap.yaml` | 将 `values.backend.config.*` 映射为后端环境变量 |
| Helm Backend 模板 | `deploy/helm/multica/templates/backend.yaml` | 用 `envFrom: configMapRef + secretRef` 注入配置，并用 checksum annotation 实现配置变更滚动 |
| 移动端配置 | `apps/mobile/app.config.ts`、`apps/mobile/.env.example` | 基于 `APP_ENV` 切换 bundle id/display name，`EXPO_PUBLIC_*` 注入运行时 API URL |
| 桌面端环境 | `apps/desktop/.env.development.local` | 由 `scripts/dev-env.sh` 管理，注入 `VITE_API_URL` / `VITE_WS_URL` |
| 全局示例 | `.env.example` | 文档化全部服务端环境变量（640+ 行），含数据库、邮件、存储、OAuth、速率限制、插件、集成等分类说明 |

## 3. 架构与设计约定

### 3.1 优先级模型：override > env > default
Daemon 配置明确采用「CLI flag > 环境变量 > 内置默认值」的三级优先级（见 `LoadConfig` 中每个字段都先读 `envOrDefault`，再判断 `overrides.X != 0`）。该模式贯穿整个后端：例如 `MULTICA_SERVER_URL`、`MULTICA_DAEMON_POLL_INTERVAL`、`MULTICA_AGENT_TIMEOUT`、`MULTICA_WORKSPACES_ROOT` 等均遵循此顺序。

### 3.2 配置分层
- **平台层**（Kubernetes/Docker Compose）：Helm `values.yaml` → `configmap.yaml`/`existingSecret` → Pod 环境变量。生产不将真实值提交到 git。
- **应用层**（Go 后端）：`os.Getenv` 直读，无集中配置文件格式（除可选 feature flags YAML）。`_example` 文件充当契约文档。
- **客户端层**：Web 用 `NEXT_PUBLIC_*` 和 `REMOTE_API_URL`；Desktop 用 `VITE_*`；Mobile 用 `EXPO_PUBLIC_*`。三者互不共享，但都指向同一后端 origin。

### 3.3 运行时 URL 推导策略
`runtime-urls.ts` 对 `NEXT_PUBLIC_API_URL` 做严格清洗：必须是 http(s) URL，且自动剥离末尾 `/api` 后缀以避免常见的双前缀错误（#6619、MUL-5922）。`NEXT_PUBLIC_WS_URL` 未设置时，会从 API base 派生 `wss://.../ws`，确保 HTTP 与 WS 共享同一挂载前缀。Dev 模式下若未显式配置，回退到 `http://localhost:8080`。

### 3.4 特性开关（Feature Flags）
`server/pkg/featureflag` 提供独立的配置子系统：YAML 文件（路径由 `MULTICA_FEATURE_FLAGS_FILE` 指定）定义每条 flag 的 `default`、`variant`、`percent`、`allow/deny` 等规则；`FF_<FLAG_KEY>` 环境变量以最高优先级覆盖。当文件缺失时服务仍可启动，仅当文件存在但解析失败时才 fail-fast。

### 3.5 安全与密钥
- 敏感值（`JWT_SECRET`、`POSTGRES_PASSWORD`、`RESEND_API_KEY`、`GOOGLE_CLIENT_SECRET`、`CLOUDFRONT_PRIVATE_KEY` 等）通过 Helm `existingSecret` 注入，不在 chart 模板中生成。
- `backend.yaml` 使用 `checksum/config` 和 `checksum/secret` annotation，使 ConfigMap/Secret 变更触发 Pod 滚动，避免热更新失效。
- `.env.example` 中对 `JWT_SECRET` 有强制要求：production 下必须设置强随机值，否则拒绝启动。

### 3.6 多环境隔离
- Docker Compose self-host：`docker-compose.selfhost.yml` 与 `Makefile` 将 `APP_ENV=production` 固定到容器，本地开发留空。
- Helm：`values.backend.config.appEnv` 默认为 `production`。
- Mobile：`APP_ENV` 决定 bundle id、display name（dev/staging/production 三套独立标识符）。

## 4. 约定与约束

1. **所有后端配置项以 `MULTICA_*` 或标准第三方名（`DATABASE_URL`、`SMTP_*`、`S3_*`、`GOOGLE_*`、`POSTHOG_*`）暴露**，新增配置应同步更新 `.env.example` 注释。
2. **Helm `values.yaml` 是部署参数的单一来源**，不应在 chart 模板中硬编码业务值；敏感值走 `existingSecret`，非敏感值走 `configmap.yaml` 映射。
3. **前端 URL 必须通过 `runtime-urls.ts` 的解析函数获取**，禁止在业务代码中拼接字符串构造 API 地址，以避免 `/api/api/**` 类前缀错误。
4. **Mobile 的 `EXPO_PUBLIC_*` 在 Release 构建时被固化**，修改后需重新构建；开发阶段需重启 Metro 才能生效。
5. **Daemon 配置允许通过 CLI Overrides 覆盖环境变量**，用于测试与嵌入式场景（如 Electron 调用时传入 `--profile`、`--health-port` 等）。
6. **Feature flags 的 YAML 文件解析失败即 fail-fast**，与 `DATABASE_URL`、`JWT_SECRET` 缺失同等级别的启动失败语义。
7. **`.env.example` 中的注释是权威文档**：每个变量的用途、默认值、安全影响、是否热更新均在注释中说明，新增变量必须补齐注释。
8. **Kubernetes 部署中 ConfigMap/Secret 变更通过 checksum annotation 触发滚动**，不得依赖进程内热重载来拉取新配置。

## 5. 适用性

本仓库存在完整、成体系的配置系统，覆盖后端、前端、移动端、Kubernetes 部署四个层面，因此本卡片适用。
