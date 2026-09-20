---
kind: frontend_style
name: Multica 前端样式体系：Tailwind + shadcn/base-nova + CSS 变量设计令牌
category: frontend_style
scope:
    - '**'
source_files:
    - packages/ui/styles/tokens.css
    - packages/ui/styles/base.css
    - apps/web/app/globals.css
    - apps/mobile/global.css
    - apps/mobile/tailwind.config.js
    - apps/mobile/lib/theme.ts
    - packages/ui/components.json
    - apps/web/components.json
    - apps/web/postcss.config.mjs
---

## 1. 采用的系统与方法论

Multica 的跨端 UI 样式以 **Tailwind CSS v4**（`@tailwindcss/postcss`）为核心，结合 **shadcn/ui**（风格 `base-nova`）与自研的 **CSS 自定义属性令牌层**，在 Web/Desktop（Next.js + Electron）和 Mobile（Expo/React Native）三端保持一致的设计语言。

- Web/Desktop：通过 Next.js App Router 的 `app/globals.css` 引入 Tailwind、`tw-animate-css`、`shadcn/tailwind.css`，并 `@import` 共享包 `packages/ui/styles/tokens.css` 与 `base.css`；使用 `@source` 指令让 Tailwind 扫描 `packages/ui`、`packages/core`、`packages/views` 中的组件类名。
- Mobile：基于 Expo + NativeWind，`apps/mobile/global.css` 用 `@tailwind base/components/utilities` 注入基础样式，`tailwind.config.js` 通过 `nativewind/preset` 将 CSS 变量映射到 RN 样式，并使用 `darkMode: 'class'` 实现明暗主题切换。
- 组件库：`packages/ui` 是原子组件层，遵循 shadcn 约定（`components/ui/*` 为原子、`components/common/*` 为业务通用组件），并通过 `components.json` 注册别名指向 `@multica/ui/*`。Web 端还额外注册了 `@reui` 远程 registry（需 `REUI_LICENSE_KEY`）以拉取 base-nova 扩展组件。

## 2. 关键文件与包

| 文件 | 作用 |
|---|---|
| `packages/ui/styles/tokens.css` | Web/Desktop 共享设计令牌：颜色、阴影、圆角、字体、侧边栏、品牌色、图表色、滚动条、查找高亮等，定义 `@theme inline` 与 `:root` / `.dark` 两套值 |
| `packages/ui/styles/base.css` | 共享基础样式：聊天启动器避让工具类 (`pe-chat-launcher`、`pb-chat-launcher`、`above-chat-launcher`)、Shiki 双主题、onboarding/welcome/chat 动画、导航进度条、border-beam、侧边栏拖拽光标、滚动条全局样式、CJK 排版优化、`::highlight` 查找高亮 |
| `apps/web/app/globals.css` | Web 入口：导入 Tailwind/shadcn/tokens/base，声明 `@custom-variant dark`，配置字体栈（Inter + PingFang SC/Hiragino Sans/Noto Sans CJK 多语言回退） |
| `apps/mobile/global.css` | Mobile 入口：HSL 形式的 CSS 变量令牌，含 Multica 自定义 token（brand/success/warning/info/priority/code-surface）及 5 级 surface 高程阶梯（L98/L90/L96.1/L84） |
| `apps/mobile/tailwind.config.js` | Mobile Tailwind 配置：映射 CSS 变量到 Tailwind color 语义，扩展 brand/success/warning/info/priority/code-surface/surface-1/surface-2，启用 `tailwindcss-animate` |
| `apps/mobile/lib/theme.ts` | Mobile 的 TS 镜像：与 `global.css` 严格一一对应的 JS 对象，供 React Navigation 与内联样式使用，注释强制要求“改 CSS 变量必须同步修改此文件” |
| `packages/ui/components.json` | shadcn 配置：style=`base-nova`，baseColor=`zinc`，`cssVariables:true`，注册 `@reui` 远程 registry |
| `apps/web/components.json` | Web 端 shadcn 配置：别名指向 `@multica/ui/*`，复用同一套原子组件 |
| `apps/web/postcss.config.mjs` | 仅启用 `@tailwindcss/postcss`，由 Next.js 内置 PostCSS 管线驱动 |

## 3. 架构与设计约定

### 令牌分层
- **应用壳层** (`--app-shell` / `--page-canvas` / `--surface` / `--surface-raised` / `--surface-hover` / `--surface-selected` / `--surface-border`)：区分页面背景、内容卡片、悬浮覆盖物，用于 Web/Desktop 的布局层级。
- **语义色层** (`--primary` / `--secondary` / `--muted` / `--accent` / `--destructive` / `--success` / `--warning` / `--info` / `--brand`)：业务语义，所有组件通过语义 token 而非硬编码色值引用。
- **排版层**：`tokens.css` 中定义了 10 级命名化字号（micro/caption/label/body/body-lg/title-sm/title/title-lg/display-sm/display），替代 Tailwind 默认 scale，每个 token 自带 line-height，禁止随意新增任意像素值。
- **阴影层**：`--surface-shadow` / `--floating-shadow` / `--menu-shadow` 分别对应卡片、弹窗、菜单三种层级。
- **平台差异**：Mobile 使用 HSL 变量（便于 NativeWind 解析），Web/Desktop 使用 OKLCH 变量（更好的感知均匀性），但语义完全对齐。

### 明暗主题策略
- Web/Desktop：`.dark` 选择器下覆盖全部 token，通过 HTML `<html class="dark">` 切换；`globals.css` 中 `@custom-variant dark (&:is(.dark *))` 使 Tailwind 能生成 `.dark *` 变体。
- Mobile：`darkMode: 'class'`，同时维护 `lib/theme.ts` 的 light/dark 两个 JS 对象，与 `global.css` 的 `:root` / `.dark:root` 保持一一对应。

### 高程系统（Elevation Scale）
Mobile 文档明确定义了 5 级表面阶梯（light mode L100 → L98 → L96.1 → L90 → L84），参考 Refactoring UI ≥5% 明度差阈值与 Material 3 surface-container 比例；Web/Desktop 通过 OKLCH 的 `--surface-*` 系列实现相同视觉层次。边框统一设在 L84（light）/ L25%（dark），确保在所有层级上可见。

### 可访问性约束
- 所有文本对比度经 WCAG AA 验证：`--muted-foreground` 在 light 模式下取 L=0.505，保证对最暗表面（sidebar-accent）达到 4.88:1；`--faint-foreground` 取 L=0.606，满足非文本 3:1 门槛。
- Dark 模式下的 `--muted-foreground` 与 `--faint-foreground` 对称取值，确保明暗两侧可读性一致。
- 图表色从 `--chart-1`（品牌蓝）到 `--chart-5` 逐级降低饱和度与亮度，避免五组同等权重的灰色争抢注意力。

### 响应式与平台适配
- Web/Desktop：Tailwind 断点 + `prefers-reduced-motion` 媒体查询禁用动画；iOS Safari 输入框最小 16px 防止缩放。
- Mobile：NativeWind 自动将 Tailwind 类编译为 RN 样式；`hairlineWidth()` 提供设备相关边框宽度。
- 字体栈按语言动态切换：`[lang|="ja"]` 提升 Hiragino/Yu Gothic 优先级，避免 zh/ko 用户被错误分配中日韩字形。

## 4. 约定与约束

- **禁止随意新增字号**：`tokens.css` 注释明确指出，产品 UI 只能使用该文件中定义的 10 级 text token，历史遗留的 51 个任意像素字号已被逐步替换。
- **颜色必须走语义 token**：组件不得直接写十六进制色值，须通过 `bg-primary` / `text-muted-foreground` 等语义类引用。
- **Mobile 令牌必须双向同步**：`apps/mobile/global.css` 与 `apps/mobile/lib/theme.ts` 必须一一对应，修改任一文件时必须同步更新另一个（见文件顶部注释与 `rnr-migration.md §5`）。
- **主题切换通过 class 而非 prefers-color-scheme**：Web 与 Mobile 均使用 `class="dark"` 控制，避免浏览器自动切换与应用状态不同步。
- **动画需尊重 `prefers-reduced-motion`**：`base.css` 中所有动画均在 `@media (prefers-reduced-motion: reduce)` 下被禁用或降级。
- **CSP 安全字体**：Web 字体栈在静态 CSS 中声明，不依赖内联 `<style>`，以满足 CSP 限制。
- **shadcn 组件来源**：Web 端通过 `@reui` 远程 registry 拉取 base-nova 组件，需要 `REUI_LICENSE_KEY` 环境变量；本地 `packages/ui/components/ui/*` 为已落地的原子组件副本。
- **Markdown/代码块主题**：通过 Shiki 双主题 CSS 变量（`--shiki-light` / `--shiki-dark`）切换，与页面主题联动。
- **查找高亮**：使用 CSS Custom Highlight API 的 `::highlight(multica-find)` 与 `::highlight(multica-find-active)`，不污染 DOM，支持 Markdown 与 contenteditable 编辑器。
