# Multica 内部桌面端发布、下载与更新迁移设计

日期：2026-09-10
状态：已确认，实施中
适用分支：`feature/internal-server`

## 1. 背景

公司已经自部署 Multica，统一访问地址为 `https://mc.ai.caijj.net/`，并已构建面向公司员工的 macOS Intel、macOS Apple Silicon、Windows x64 和 Windows ARM64 桌面测试安装包。

当前桌面包只修改了业务服务地址。其更新配置仍由 `electron-builder.yml` 写入官方 GitHub 发布源 `multica-ai/multica`；Web 下载页也从官方 GitHub API 获取安装包，侧边栏下载入口直接跳转 `https://multica.ai/download`。

现有员工安装的版本为 `0.0.0-gca47495fc-dirty`。该版本可以正常使用内部服务，但不是可持续发布版本：它没有内部发布序列，且无法从内部服务器发现新版本。

## 2. 决策

采用单一迁移方案：**所有现有用户覆盖安装一次内部正式版 `1.0.0`**。

不向员工提供修改 `app-update.yml`、替换应用资源、重签名或清理更新缓存的自助迁移方法。更新源切换属于发布系统职责，不转嫁给用户。

迁移版 `1.0.0` 保持当前 `appId`、应用名称和用户数据目录不变，以保留已有登录状态、`~/.multica/desktop.json` 和桌面偏好。内部版与官方版不支持在同一台电脑上并存；公司设备只安装内部版。

从 `1.0.0` 开始，后续版本通过内部发布源自动更新，例如 `1.0.1`、`1.0.2`。

## 3. 目标与非目标

### 3.1 目标

- Web 下载页只展示公司支持的四个平台/架构，Mac 两行同时保留 DMG 和 ZIP 入口，Windows 两行展示 EXE。
- Web 安装包下载和 Desktop 更新器统一使用内部发布源，不回退官方 GitHub release。
- 保留官方已有的 Desktop CLI 打包及恢复逻辑，不把 CLI 改造纳入本次范围，也不面向员工单独发布 CLI 压缩包。
- 现有用户只需覆盖安装一次，后续可以在客户端内检查并安装更新。
- 版本可比较、可追溯、可回滚，发布文件有完整性校验。
- 发布过程中不会出现“清单已经可见但安装包尚未上传”的半发布状态。

### 3.2 非目标

- 不支持 Linux 或移动端桌面包发布。
- 不允许员工手工编辑安装目录中的更新配置。
- 不在 PostgreSQL 中保存安装包。
- 不新建 Desktop 更新业务表或后端版本查询 API。
- 本次不实现官方版和内部版在同一设备并存。
- 本次不改造 CLI 的联网恢复行为。

## 4. 支持矩阵

| 平台 | 用户安装包 | 处理器范围 | 自动更新清单 |
| --- | --- | --- | --- |
| macOS Intel | `multica-desktop-1.0.0-mac-x64.dmg` | Intel Core 系列 | `latest-x64-mac.yml` |
| macOS Apple Silicon | `multica-desktop-1.0.0-mac-arm64.dmg` | Apple M 系列 | `latest-mac.yml` |
| Windows x64 | `multica-desktop-1.0.0-windows-x64.exe` | Intel/AMD 64 位 | `latest.yml` |
| Windows ARM64 | `multica-desktop-1.0.0-windows-arm64.exe` | Snapdragon/ARM64 | `latest-arm64.yml` |

Linux 和移动端不出现在内部下载页中。

## 5. 内部发布源

统一发布地址：

```text
https://mc.ai.caijj.net/releases/desktop/
```

服务器目录：

```text
/opt/multica-releases/desktop/
```

Nginx 在现有前端/后端代理规则之前增加高优先级静态路由。该路径不要求 Web 登录 Cookie，因为 Electron 更新器不会携带 Multica 浏览器会话；访问范围由公司内网、VPN、防火墙和域名入口控制。

Nginx 应支持：

- HTTPS；
- `GET`、`HEAD`；
- Range 请求；
- 正确的文件长度和内容类型；
- `latest*.yml`、`release.json`、`checksums.txt` 禁止长缓存；
- 带版本号的 DMG、ZIP、EXE 和 blockmap 可使用长期不可变缓存。

当前该 URL 最终返回 Next.js `404`。上线前必须验证每个明确文件 URL 返回 `200`，不能只检查目录首页。

### 5.1 当前服务器的实际改造点

当前 gateway 使用 `/opt/multica-poc/nginx.conf`，由 `/opt/multica-poc/compose.poc.yml` 挂载到只读的 `nginx:stable-alpine` 容器。gateway 以 `101:101` 运行，当前只有证书和 Nginx 配置两个只读挂载；兜底 `location /` 会把 `/releases/desktop` 转发给 frontend。

在 `compose.poc.yml` 的 gateway volumes 中增加：

```yaml
- /opt/multica-releases:/srv/releases:ro
```

宿主机目录 `/opt/multica-releases/desktop` 使用目录权限 `0755`、发布文件 `0644`，确保容器用户 `101:101` 只读访问。发布目录不得保存数据库密码、Token 或证书私钥。

在 `nginx.conf` 的 `http` 块增加缓存策略映射：

```nginx
map $uri $desktop_release_cache_control {
    default "public, max-age=31536000, immutable";
    ~^/releases/desktop/(release\.json|checksums\.txt|latest.*\.yml)$ "no-cache, no-store, must-revalidate";
}
```

在 HTTPS `server` 中、现有 API location 和兜底 `location /` 之前增加：

```nginx
location = /releases/desktop {
    return 308 /releases/desktop/;
}

location ^~ /releases/desktop/ {
    alias /srv/releases/desktop/;
    autoindex off;
    limit_except GET HEAD { deny all; }
    add_header Cache-Control $desktop_release_cache_control always;
    add_header X-Content-Type-Options nosniff always;
}
```

`^~` 确保发布文件不会进入现有 frontend 代理。Nginx 静态文件处理原生支持 Range 请求；现有 `mime.types` 已覆盖 DMG、EXE、ZIP 和 JSON，YML 与 blockmap 可使用默认 `application/octet-stream`。

修改后先执行 Nginx 语法检查，再重建 gateway 使新增 volume 生效。重建只影响 gateway，backend、frontend 和 PostgreSQL 不重启。验证至少包括：

```text
GET/HEAD release.json = 200
GET/HEAD latest.yml = 200
GET/HEAD latest-arm64.yml = 200
GET/HEAD latest-mac.yml = 200
GET/HEAD latest-x64-mac.yml = 200
不存在文件 = 404
POST 发布文件路径 = 403 或 405
Range 请求 = 206
```

建议的服务器操作顺序：

```bash
cd /opt/multica-poc

cp -p nginx.conf nginx.conf.bak.before-desktop-releases
cp -p compose.poc.yml compose.poc.yml.bak.before-desktop-releases

mkdir -p /opt/multica-releases/desktop
chmod 0755 /opt/multica-releases /opt/multica-releases/desktop

docker compose \
  -f docker-compose.selfhost.yml \
  -f compose.poc.yml \
  -f compose.images.lock.yml \
  config --quiet

docker exec multica-poc-gateway-1 nginx -t

docker compose \
  -f docker-compose.selfhost.yml \
  -f compose.poc.yml \
  -f compose.images.lock.yml \
  up -d --no-deps --force-recreate gateway
```

放入经过验证的发布文件后，从客户端网络执行：

```bash
curl --noproxy '*' -I \
  https://mc.ai.caijj.net/releases/desktop/release.json

curl --noproxy '*' -I \
  -H 'Range: bytes=0-1023' \
  https://mc.ai.caijj.net/releases/desktop/multica-desktop-1.0.0-windows-x64.exe
```

第一条应返回 `200`，第二条应返回 `206 Partial Content`。不得使用 `-k` 绕过 TLS 验证。

Nginx 改造回滚：恢复两份 `.bak.before-desktop-releases` 文件，使用同一组三个 Compose 文件仅重建 gateway，再确认 `/healthz`、Web 首页和 WebSocket 正常。发布目录可保留，不再挂载时不会对外暴露。

## 6. 发布文件布局

```text
/opt/multica-releases/desktop/
├── release.json
├── checksums.txt
├── latest.yml
├── latest-arm64.yml
├── latest-mac.yml
├── latest-x64-mac.yml
├── multica-desktop-1.0.0-windows-x64.exe
├── multica-desktop-1.0.0-windows-x64.exe.blockmap
├── multica-desktop-1.0.0-windows-arm64.exe
├── multica-desktop-1.0.0-windows-arm64.exe.blockmap
├── multica-desktop-1.0.0-mac-arm64.dmg
├── multica-desktop-1.0.0-mac-arm64.zip
├── multica-desktop-1.0.0-mac-arm64.zip.blockmap
├── multica-desktop-1.0.0-mac-x64.dmg
├── multica-desktop-1.0.0-mac-x64.zip
└── multica-desktop-1.0.0-mac-x64.zip.blockmap
```

DMG 和 EXE 是四个主要桌面安装包。macOS ZIP 同时作为下载页备用格式和 electron-updater 更新载荷；blockmap 与 `latest*.yml` 不在用户下载页面展示，但不能删除。`checksums.txt` 仅供管理员人工核验完整性。

文件在发布源上保留 electron-builder 生成的规范名称，不再手工改名。Web 页面使用友好标签展示平台和芯片类型，不依赖改文件名实现可读性。

## 7. `release.json`

Web 下载页不再调用 GitHub API，改为读取内部清单。为了复用官方现有解析逻辑，`release.json` 主动采用 GitHub Releases API 兼容的数组结构：

```json
[
  {
    "tag_name": "1.0.0",
    "published_at": "2026-09-10T00:00:00Z",
    "html_url": "https://mc.ai.caijj.net/changelog#release-1-0-0",
    "prerelease": false,
    "draft": false,
    "assets": [
      { "name": "multica-desktop-1.0.0-mac-x64.dmg", "browser_download_url": "https://mc.ai.caijj.net/releases/desktop/multica-desktop-1.0.0-mac-x64.dmg" },
      { "name": "multica-desktop-1.0.0-mac-x64.zip", "browser_download_url": "https://mc.ai.caijj.net/releases/desktop/multica-desktop-1.0.0-mac-x64.zip" },
      { "name": "multica-desktop-1.0.0-mac-arm64.dmg", "browser_download_url": "https://mc.ai.caijj.net/releases/desktop/multica-desktop-1.0.0-mac-arm64.dmg" },
      { "name": "multica-desktop-1.0.0-mac-arm64.zip", "browser_download_url": "https://mc.ai.caijj.net/releases/desktop/multica-desktop-1.0.0-mac-arm64.zip" },
      { "name": "multica-desktop-1.0.0-windows-x64.exe", "browser_download_url": "https://mc.ai.caijj.net/releases/desktop/multica-desktop-1.0.0-windows-x64.exe" },
      { "name": "multica-desktop-1.0.0-windows-arm64.exe", "browser_download_url": "https://mc.ai.caijj.net/releases/desktop/multica-desktop-1.0.0-windows-arm64.exe" }
    ]
  }
]
```

清单只需列出员工可选择的六个下载文件：两个 DMG、两个 Mac ZIP 和两个 Windows EXE。Web 服务器端每 5 分钟刷新一次；读取失败时页面显示版本不可用，不回退官方 GitHub，避免误发官方包。

## 8. Web 改造

- 将下载页的数据源从官方 GitHub API 改为固定读取 `https://mc.ai.caijj.net/releases/desktop/release.json`，不新增环境变量、Helm 或主 Compose 配置。
- 将共享侧边栏中的绝对下载地址改为同域 `/download`。
- 下载页只渲染 macOS Intel、macOS Apple Silicon、Windows x64 和 Windows ARM64 四行；Mac 保留官方页面已有的 ZIP 备用下载，Linux 不展示。
- 下载页保留现有 CLI 和 Cloud runtime 两块内容；“只发布四个桌面安装包”仅限制公司维护的安装文件，不代表删除这两个页面功能区。
- 保留系统/架构检测；检测不确定时要求用户手工选择。
- 下载按钮直接指向 `release.json` 中的完整 HTTPS 地址。
- `/changelog` 继续复用原有更新日志页面组件、布局、时间线和样式，但改为读取独立维护的中文版本数据。页面定位覆盖 Desktop、Web、后端和部署改造，页面标题不限定桌面端也不反复强调“内部版”。每次公司发版更新该数据并重新部署 Web；官方多语言日志数据源码保留，但不另设页面入口。
- Web 改造后构建公司自己的 `multica-web` 镜像并重新部署 frontend；后端 API 镜像无需因下载功能单独重建。

## 9. Desktop 更新改造

内部 Desktop 构建使用 electron-builder `generic` provider：

```yaml
publish:
  provider: generic
  url: https://mc.ai.caijj.net/releases/desktop
```

该配置写入安装包的 `Contents/Resources/app-update.yml`（macOS）或 `resources/app-update.yml`（Windows）。运行时不再读取 `owner`、`repo` 和官方 GitHub provider。

保持现有检查行为：

- 应用启动约 5 秒后检查；
- 持续运行时每小时检查；
- 设置页允许手动检查；
- 自动更新关闭后取消后台检查；
- 下载完成后提示，退出应用时安装。

架构通道保持：

- Windows x64：`latest.yml`；
- Windows ARM64：`latest-arm64.yml`；
- macOS Apple Silicon：`latest-mac.yml`；
- macOS Intel：`latest-x64-mac.yml`。

Desktop 继续沿用官方现有的 CLI 编译、内置和恢复逻辑，本次只修改应用更新 provider，不修改 `daemon-manager` 或 CLI 下载实现。

Desktop 更新完成提示中的“查看更新日志”链接统一指向 `https://mc.ai.caijj.net/changelog#release-<version>`。Web 中已有的更新日志入口也自然访问该公司维护页面，不新增官方更新日志入口。

## 10. 版本策略

- 内部桌面端发布序列从稳定 SemVer `1.0.0` 开始。
- 每次发布必须来自干净提交；版本中禁止出现 `dirty`。
- 补丁修复递增 patch：`1.0.1`、`1.0.2`。
- 有兼容性变化时递增 minor：`1.1.0`。
- 发布提交使用内部 Git 标签 `v1.0.0`，安装包、YML、`release.json` 和 `checksums.txt` 的版本必须一致。
- 发布前核对 Desktop 源码与线上后端 API 版本兼容；不能仅因同一仓库就假定当前 checkout 与服务器镜像一致。
- 不通过手工重命名安装包隐藏内部版本，文件名必须可追溯到 Git 标签。

## 11. 签名要求

macOS 自动更新是发布门禁：

- 必须使用 Apple Developer ID Application 证书签名；
- 必须完成 Apple notarization；
- 从内部正式版 `1.0.0` 开始，所有后续版本必须使用同一签名身份；
- 签名或公证失败时不得更新 `latest-mac.yml` 或 `latest-x64-mac.yml`。

当前已安装的测试版未签名，因此只能通过人工覆盖安装迁移。没有 Apple 签名能力时，Mac 后续只能继续由 Web 提示并人工下载安装，不能承诺自动更新。

Windows 正式发布建议使用公司代码签名证书，减少 SmartScreen 警告。试点阶段若明确接受未签名风险，可以先验证内部更新链路，但必须如实说明发布者状态。

## 12. 原子发布流程

1. 确认发布提交干净、版本标签正确，并核对后端兼容性。
2. 运行 Desktop 测试、类型检查和打包脚本。
3. 分别验证应用架构、安装包完整性、签名和 SHA-256。
4. 生成 `checksums.txt` 和 `release.json`。
5. 上传版本化安装包、macOS 更新 ZIP 和 blockmap 到临时目录。
6. 从客户端网络对每个文件执行 `HEAD`/下载校验，并比对哈希。
7. 将版本化文件原子移动到正式目录。
8. 最后上传 `latest.yml`、`latest-arm64.yml`、`latest-mac.yml`、`latest-x64-mac.yml` 和 `release.json`。
9. 验证 Web 下载页四个按钮及四种平台更新检查。
10. 保留上一正式版本文件和清单快照用于回滚。

发布检查遇到任一失败必须停止，不更新 latest 清单。

## 13. 全员一次性迁移

### 13.1 发布前

- 先通知当前用户暂时关闭自动更新，避免下载官方版本。
- 完成内部发布源、Web 下载页和 `1.0.0` 安装包验证。
- 选择少量测试设备完成覆盖安装：Intel Mac、Apple Silicon Mac、Windows x64、Windows ARM64 各至少一台。

### 13.2 用户操作

1. 保存正在进行的工作并退出 Multica。
2. 打开公司内部 Web 下载页。
3. 根据系统和芯片类型下载对应安装包。
4. 覆盖安装 Multica 内部正式版 `1.0.0`。
5. 启动应用，确认仍能使用原公司邮箱登录并进入原工作区。
6. 确认服务地址为 `https://mc.ai.caijj.net/`。
7. 打开“设置 → 更新”，确认当前版本为 `1.0.0`，再执行一次手动检查。

不要求用户卸载旧版，不要求删除 `~/.multica`，不要求修改 YAML。覆盖安装失败时先保留用户数据目录，联系管理员处理，禁止指导用户清空整个配置目录。

### 13.3 迁移完成标准

- 服务器侧可以看到新版本正常登录和运行时连接；
- 四类设备的业务服务地址和更新源都指向内部域名；
- 用户工作区、聊天和本地偏好没有因覆盖安装丢失；
- 当前版本不含 `dirty`；
- 后续测试版本可以从内部源被发现、下载和安装。

## 14. 测试与验收

### 14.1 自动化测试

- Web 内部 `release.json` 解析、失败关闭和四平台映射测试。
- 下载入口同域跳转测试。
- Web `/changelog` 使用独立中文版本数据、Desktop 更新提示使用相同页面链接的测试。
- Desktop generic provider 构建配置测试。
- 四个架构 channel 与清单文件名测试。

### 14.2 产物检查

- `app-update.yml` 只包含内部 generic provider，不含 `multica-ai/multica`。
- DMG 使用 `hdiutil verify`。
- 应用主程序和内置 CLI 架构与安装包一致。
- 所有发布文件与 `checksums.txt` 一致。
- Nginx 支持 HEAD 和 Range，不把 `/releases/desktop/` 转发给 Next.js。

### 14.3 真实设备升级测试

- 在四类真实设备上安装旧测试版并保留登录状态。
- 覆盖安装 `1.0.0`，验证数据与配置保留。
- 发布更高测试版本，验证启动检查、手动检查、下载、退出安装和重启版本变化。
- Mac 必须验证签名与 notarization；不能用关闭 Gatekeeper 代替验收。

## 15. 回滚

- 发布前保存上一版 `latest*.yml`、`release.json` 和全部版本化文件。
- 新版故障时先停止 latest 清单发布，避免扩大影响。
- 已升级用户使用上一版安装包人工覆盖；不要发布比当前版本更低的 latest 指望自动降级。
- Web 下载页切回上一份 `release.json`。
- 回滚不删除用户数据目录和 `~/.multica/desktop.json`。

## 16. 验收标准

- `/releases/desktop/release.json` 和四份 latest 清单返回 `200`。
- Web 下载页不再请求官方 GitHub，不再跳转 `multica.ai/download`。
- 四个用户安装按钮均下载公司构建产物。
- 新 Desktop 的 `app-update.yml` 只指向内部发布源。
- `1.0.0` 覆盖安装保留用户登录、工作区访问和本地配置。
- 四类真实设备均完成一次内部后续版本更新测试。
