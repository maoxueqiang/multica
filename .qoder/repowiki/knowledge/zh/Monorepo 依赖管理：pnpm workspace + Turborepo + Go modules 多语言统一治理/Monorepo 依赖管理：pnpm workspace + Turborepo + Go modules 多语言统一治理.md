---
kind: dependency_management
name: Monorepo 依赖管理：pnpm workspace + Turborepo + Go modules 多语言统一治理
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - turbo.json
    - .npmrc
    - knip.jsonc
    - server/go.mod
    - server/go.sum
    - Makefile
    - .goreleaser.yml
    - scripts/check.sh
---

## 1. 使用的系统与工具

本仓库是一个多语言 Monorepo，采用 **pnpm workspace + Turborepo** 管理前端/共享包依赖，使用 **Go modules（go.mod/go.sum）** 管理服务端依赖，并通过 **Makefile + Docker Compose** 统一本地开发、自托管与发布流程。

- **Node/TS 侧**：根 `package.json` 声明 `packageManager: pnpm@10.28.2`，通过 `pnpm-workspace.yaml` 将 `apps/*` 与 `packages/*` 纳入工作区；Turborepo (`turbo.json`) 编排 `build/typecheck/test/lint/dev` 任务并缓存输出。
- **Go 侧**：`server/go.mod` 以 `module github.com/multica-ai/multica/server` 声明模块，`go.sum` 锁定所有依赖版本；构建通过 `goreleaser.yml` 生成跨平台二进制并发布 Homebrew tap。
- **统一入口**：根 `Makefile` 提供 `setup/start/check/db-reset/sqlc` 等目标，串联 `pnpm install`、PostgreSQL 初始化、`go run ./cmd/migrate up`、`scripts/check.sh`（TypeScript typecheck → Vitest → Go tests → Playwright E2E）。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `package.json` | 根工作区脚本、`engines.node >= 22`、`pnpm.overrides` 强制安全版本 |
| `pnpm-workspace.yaml` | 工作区范围 + `catalog:` 集中声明 React/Tailwind/Vitest/Zod 等公共依赖版本 |
| `turbo.json` | 任务图、`globalEnv`、`outputs` 缓存策略、`mdx` 前置任务 |
| `.npmrc` | `shamefully-hoist=true`，使未显式声明的 import 仍可解析（配合 knip 校验） |
| `knip.jsonc` | 依赖分析规则，排除 `apps/mobile`，为 `packages/ui/views/core` 配置 entry/project |
| `server/go.mod` / `server/go.sum` | Go 后端全部第三方依赖及间接依赖锁定 |
| `Makefile` | 本地/自托管环境生命周期、`build` 注入 ldflags、`test` 触发 race detector |
| `.goreleaser.yml` | CLI 多架构打包、归档命名模板、Homebrew tap 发布 |
| `scripts/check.sh` | 全链路验证：typecheck → unit → go test → E2E |

## 3. 架构与约定

### 3.1 前端/共享包依赖（pnpm catalog + overrides）

- **Catalog 集中化**：`pnpm-workspace.yaml` 的 `catalog:` 段声明 `react`、`@types/react`、`typescript`、`vitest`、`tailwindcss`、`zod` 等高频依赖的版本范围。各 workspace 的 `package.json` 通过 `"@types/react": "catalog:"` 引用，避免重复声明。
- **安全覆盖**：根 `package.json.pnpm.overrides` 强制升级存在漏洞的传递依赖（如 `postcss`、`uuid`、`shell-quote`、`minimatch>brace-expansion`、`builder-util-runtime`），确保所有子包继承同一补丁版本。
- **仅安装必要构建依赖**：`pnpm.onlyBuiltDependencies: [esbuild, electron]`，减少 `node_modules` 体积。
- **Workspace 边界**：`turbo.json` 中 `tasks.build.dependsOn: ["^build", "mdx"]` 保证依赖先于消费者构建；`dev`/`dev:staging` 标记为 `cache: false, persistent: true` 以支持热重载。
- **依赖审计**：`knip.jsonc` 启用 `files`、`dependencies`、`unlisted` 三项检查，配合 `scripts/check-ui-wildcard-exports.mjs` 约束 `packages/ui` 的四个 wildcard export，防止隐式导出扩散。

### 3.2 Go 后端依赖（modules + lockfile）

- `server/go.mod` 明确声明 `go 1.26.6` 及所有 `require` 项（AWS SDK v2、chi/v5、pgx/v5、redis/go-redis、openai-go/v3、slack-go/slack 等），间接依赖由 `go mod tidy` 维护在 `go.sum`。
- 构建时通过 Makefile 注入 `ldflags -X main.version/-commit/-date`，CLI 与 server 共用同一份版本信息。
- 无 vendoring；依赖从 Go Proxy 拉取，CI 应缓存 `~/go/pkg/mod`。

### 3.3 移动端独立体系

`apps/mobile` 是独立的 Expo/React Native 工程，其依赖（Expo toolchain、RN 特定包）不被根 workspace 覆盖；`knip.jsonc` 显式 `ignoreWorkspaces: ["apps/mobile"]`，说明其依赖管理与主 Monorepo 解耦。

### 3.4 发布与制品

- **CLI**：`.goreleaser.yml` 定义 `multica` 构建目标，输出 `darwin/linux/windows` 的 `amd64/arm64` 二进制，归档名同时保留 legacy（`multica_{os}_{arch}`）和 versioned（`multica-cli-{version}-{os}-{arch}`）两种格式以兼容旧版 `multica update`。
- **Homebrew**：通过 `brews` 段发布到 `multica-ai/homebrew-tap`，安装后执行 `multica version` 作为测试钩子。
- **Docker 自托管**：`Makefile selfhost/selfhost-build` 调用 `docker compose`，要求 Compose CLI v2+，自动从 `.env.example` 生成随机 JWT/PGPASS/VCSKEY。

## 4. 约定与约束

- **Node 版本锁定**：根 `package.json.engines.node >= 22`，Turborepo 注释指出 CI 固定 Node 22 工具链，且将其写入 `globalDependencies` 以保证缓存失效。
- **依赖必须显式声明**：`knip.jsonc` 注释明确指出“每个 workspace 必须声明实际导入的外部包”，`shamefully-hoist=true` 使得未声明依赖仍可在运行时解析——因此 knip 是唯一能发现未声明依赖的工具，该约束通过 CI 中的 `pnpm knip` 强制执行。
- **workspace 间依赖方向**：遵循 `views -> core + ui`，`core` 与 `ui` 互相独立；移动端只消费 `@multica/core` 的类型与纯函数，不混入 web/desktop 共享层。
- **数据库迁移顺序**：`make setup/start/check` 均先执行 `go run ./cmd/migrate up`，再启动服务或运行测试，保证 schema 一致。
- **环境变量驱动**：`turbo.json.globalEnv` 列出影响构建哈希的环境变量（`DATABASE_URL`、`PORT`、`NEXT_PUBLIC_API_URL` 等），变更这些变量会触发任务重算。
- **Go 安全扫描**：`go.mod` 末尾声明 `tool golang.org/x/vuln/cmd/govulncheck`，用于依赖漏洞检测。
- **构建产物清理**：`make clean` 删除 `server/bin`、`apps/*/dist`、`packages/*/dist`、`.turbo`、`.next`、`.expo`、`*.tsbuildinfo` 等缓存目录。

## 5. 总结

该仓库通过 **pnpm catalog + overrides** 统一管理前端依赖版本与安全补丁，用 **Turborepo** 编排跨 workspace 的构建/类型检查/测试任务并缓存输出；Go 后端以标准 `go.mod`/`go.sum` 锁定依赖，结合 `goreleaser` 发布 CLI；`Makefile` 作为单一入口串联依赖安装、DB 迁移、服务启动与全链路检查。移动端保持独立依赖体系，通过 `knip` 与 `scripts/check-ui-wildcard-exports.mjs` 强化 workspace 边界约束，形成一套覆盖多语言的 Monorepo 依赖治理方案。