---
kind: build_system
name: Multica Monorepo 构建与发布体系（pnpm + Turborepo + Go + Docker + Helm）
category: build_system
scope:
    - '**'
source_files:
    - Makefile
    - package.json
    - turbo.json
    - pnpm-workspace.yaml
    - Dockerfile
    - Dockerfile.web
    - docker-compose.selfhost.yml
    - .goreleaser.yml
    - .github/workflows/ci.yml
    - scripts/check.sh
    - scripts/dev-env.sh
    - scripts/local-env.sh
    - scripts/ensure-postgres.sh
    - scripts/test-go.sh
    - knip.jsonc
---

## 1. 整体方案

仓库采用 **pnpm workspace + Turborepo** 编排前端/共享包，Go 后端通过 `go build` / `goreleaser` 独立构建，本地开发、自托管与 CI 统一由顶层 `Makefile` 和 `docker-compose.*` 驱动。Node 工具链锁定在 Node 22（`.nvmrc` + `package.json.engines`），包管理器锁定为 `pnpm@10.28.2`（`packageManager` 字段），并通过 `pnpm-workspace.yaml` 的 `catalog:` 集中管理跨包依赖版本。

- **前端/共享包**：`apps/web`、`apps/desktop`、`apps/docs`、`packages/core/ui/views/eslint-config/tsconfig` 等均由 `turbo run` 调度，任务定义集中在根 `turbo.json`。
- **Go 后端**：`server/` 是独立 Go module，二进制通过 `make build`（本地）或 `.goreleaser.yml`（CI 多平台交叉编译）产出，产物写入 `server/bin`。
- **容器化**：后端镜像 `Dockerfile`（多阶段，`golang:1.26-alpine` → `alpine:3.21`），Web 镜像 `Dockerfile.web`（基于 Next.js standalone 输出）。自托管栈由 `docker-compose.selfhost.yml` + `docker-compose.selfhost.build.yml` 组合启动 PostgreSQL、backend、frontend。
- **Kubernetes/Helm**：`deploy/helm/multica/` 提供 Chart，CI 中通过 `scripts/helm-config.test.sh` 校验模板渲染。
- **CI**：`.github/workflows/ci.yml` 使用 `dorny/paths-filter` 按变更路径拆分 frontend/backend/sqlc/images 四个 gate，再并行执行 build/typecheck/lint/test/vet/govulncheck；另有 `release.yml`、`desktop-smoke.yml`、`mobile-verify.yml`、`openclaw-config-smoke.yml`。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `Makefile` | 默认目标 `help`；封装 selfhost、setup/start/db-reset/check、worktree 环境、`build`/`test`/`migrate`/`sqlc` 等命令 |
| `package.json` | 根脚本 `dev:*`、`build`、`typecheck`、`test`、`lint` 均通过 `turbo` 调用，排除 `@multica/mobile` |
| `turbo.json` | 定义 `mdx`/`build`/`typecheck`/`test`/`lint` 任务、`globalEnv`、`cache-inputs` 伪任务以补齐哈希边 |
| `pnpm-workspace.yaml` | workspace 范围 + `catalog:` 集中声明 React/Tailwind/Vitest/Zod 等公共依赖版本 |
| `Dockerfile` | 后端多阶段镜像，构建 server/multica/migrate/backfill_* 二进制 |
| `Dockerfile.web` | Web 应用多阶段镜像，基于 Next.js standalone 输出 |
| `docker-compose.selfhost.yml` | 自托管三服务编排（postgres/backend/frontend），端口绑定 `127.0.0.1` |
| `.goreleaser.yml` | 多 OS/Arch 交叉编译 CLI，归档 legacy/versioned 两种命名，推送 Homebrew tap |
| `.github/workflows/ci.yml` | PR/Push 流水线，path-filter 拆分 job，缓存 `.turbo/cache` |
| `scripts/check.sh` | 本地全量验证：typecheck → Vitest → Go test → 拉起服务 → Playwright E2E |
| `scripts/dev-env.sh` | 命名式开发环境注册表，自动分配端口/DB名/profile，管理 api/web/daemon/desktop 生命周期 |
| `scripts/local-env.sh` | 从 `.env` 派生 `BACKEND_PORT`/`FRONTEND_PORT`/`DATABASE_URL` 等运行时变量 |
| `scripts/ensure-postgres.sh` | 确保共享 PostgreSQL 容器运行并可达 |
| `scripts/test-go.sh` | Go 测试入口，先 `migrate up` 再跑全部 suite |
| `knip.jsonc` | 前端死代码/幽灵依赖检查配置 |

## 3. 架构与约定

### 3.1 构建任务图（Turborepo）
- `build` 依赖 `^build` 与 `mdx`，输出 `.next/**`、`dist/**`、`out/**`。
- `typecheck` 依赖 `^typecheck` 与 `mdx`。
- `test` 依赖 `^cache-inputs`——一个无副作用的递归伪任务，仅把依赖源的文件哈希注入 turbo hash，避免 views/ui 变更被缓存掩盖。
- `lint` 无依赖边，因为当前 ESLint 非类型感知，只读自身包文件。
- `mdx` 单独缓存 `.source/**`，解决 Fumadocs 并发 rm -rf 竞态。
- `dev`/`dev:staging` 禁用缓存且标记 `persistent`。

### 3.2 环境变量与端口契约
- Makefile 与 `docker-compose.selfhost.yml` 共享同一套端口推导顺序：`BACKEND_PORT > API_PORT > SERVER_PORT > PORT`，默认 8080；前端默认 3000。
- `turbo.json.globalEnv` 显式声明参与任务哈希的环境变量（`DATABASE_URL`、`PORT`、`NEXT_PUBLIC_API_URL`、`COMPOSE_PROJECT_NAME` 等），保证 CI 缓存键随部署参数变化。
- `scripts/dev-env.sh` 通过 `allocate_offset` 在 1000 槽位内为每个 checkout 分配互不冲突的 backend(18080+offset)、frontend(13000+offset)、renderer(5174+offset) 端口，并写 manifest 到 `$HOME/.multica/dev/envs/<name>/manifest.env`。

### 3.3 Go 构建与版本注入
- `make build` 与 `Dockerfile` 均通过 `-ldflags "-X main.version=... -X main.commit=..."` 注入版本信息；CLI 额外注入 `main.date`。
- `VERSION` 默认取自 `git describe --tags --match 'v[0-9]*' --always --dirty`，`COMMIT` 取自 `git rev-parse --short HEAD`，`DATE` 取 UTC ISO。
- Windows 下 `build` 目标根据 `GOOS` 自动追加 `.exe` 后缀，避免 re-exec 失败。
- `.goreleaser.yml` 同时产出 legacy (`multica_{os}_{arch}`) 与 versioned (`multica-cli-{version}-{os}-{arch}`) 两种归档，保持旧版 CLI `update` 能力。

### 3.4 容器与自托管
- 后端镜像 `ENTRYPOINT ["./entrypoint.sh"]`，暴露 8080；Web 镜像暴露 3000，运行 Next.js standalone `node apps/web/server.js`。
- `docker-compose.selfhost.yml` 要求 `JWT_SECRET` 必须设置，否则启动失败；所有服务默认绑定 `127.0.0.1`，需反向代理对外暴露。
- `make selfhost` 会检测 `docker compose` 插件版本，拒绝 v1；若官方镜像未发布则提示走 `make selfhost-build` 从源码构建。

### 3.5 CI 策略
- 首个 `changes` job 用 `dorny/paths-filter` 计算 `frontend`/`backend`/`sqlc`/`images` 布尔输出，后续 job 通过 `needs.changes.outputs.* == 'true'` 门控。
- 前端 job 缓存 `.turbo/cache`，key 包含 `runner.os`、`runner.arch`、`node` 解析版本、`github.sha`，并使用 `restore-keys` 前缀回退。
- 后端 job 启动 `pgvector/pgvector:pg17` 与 `redis:7-alpine` 作为 service，`DATABASE_URL`/`REDIS_TEST_URL` 注入测试环境。
- `sqlc-check` 运行 `make sqlc` 后 `git diff --exit-code` 校验生成代码未漂移。
- `windows-latest` 上运行一组特定 `go test` 用例，覆盖 Job Object、PowerShell argv、OpenCode 超长 prompt 等 Windows 专属行为。
- `image-budget` 仅在 PR 且改动图片时触发，限制单张位图大小。

## 4. 约定与约束

- **工作区边界**：`pnpm-workspace.yaml` 仅包含 `apps/*` 与 `packages/*`；`apps/mobile` 通过 `pnpm -C apps/mobile ...` 直接调用，不参与根 `turbo` 任务（根脚本显式 `--filter='!@multica/mobile'`）。
- **Node 版本**：`engines.node >= 22`，CI 固定 `node-version: 22`；`turbo.json` 注释说明 globalDependencies 包含 `.github/workflows/ci.yml`，防止 Node 升级后恢复旧缓存导致假绿。
- **数据库迁移**：所有涉及 DB 的 make 目标（`setup`/`start`/`db-reset`/`test`/`check`）都先调 `ensure-postgres.sh` 再执行 `go run ./cmd/migrate up`，保证迁移状态与可连接性一致。
- **端口安全**：自托管 Compose 明确禁止将端口绑定到 `0.0.0.0`，文档注释强调需经反向代理终止 TLS。
- **环境变量来源优先级**：Makefile 中 `ENV_FILE ?= .env`，若存在 `.env.worktree` 则优先；`scripts/dev-env.sh` 的 `detect_env_file` 同样优先 worktree 模式。
- **清理范围**：`make clean` 删除 `server/bin`、`apps/*/.next`、`apps/*/.expo`、`apps/*/out`、`packages/*/dist`、`.turbo`、`*.tsbuildinfo` 等构建产物。
- **SQL 代码生成**：`make sqlc` 固定调用 `sqlc@v1.31.1`，生成的 `server/pkg/db/generated` 必须受版本控制，CI 校验 diff。
- **Helm 校验**：CI 安装 Helm 后执行 `scripts/helm-config.test.sh`，确保 `deploy/helm/multica/` 模板在当前 values 下可渲染。
- **Electron 构建**：桌面端通过 `electron-builder.yml` 与 `electron.vite.config.ts` 构建，`make desktop-dev` 走 `pnpm dev:desktop`，CI 有独立的 `desktop-smoke.yml`。
- **移动端构建**：Expo 项目位于 `apps/mobile`，其构建/发布流程由自身 `app.config.ts`、`metro.config.js`、`package.json` 中的脚本管理，不在根 `turbo` 图中。

该体系将 monorepo 的前端/共享包构建交给 Turborepo 缓存加速，Go 后端保持独立模块与 goreleaser 多平台发布，本地开发通过 Makefile + 自定义 shell 脚本统一成 `make up/down/status` 等动词，形成“单一入口”的开发体验。