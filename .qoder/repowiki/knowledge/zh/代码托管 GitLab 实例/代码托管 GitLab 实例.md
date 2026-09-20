---
kind: external_dependency
name: 代码托管 GitLab 实例
slug: gitlab
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### 角色
项目主仓库托管在自部署 GitLab 实例 `git@gitlab.caijj.net:maoxueqiang/multica.git`，同时保留一个 Gitee 镜像 `old-origin` 用于历史同步。

### 使用方式
- 开发工作流基于该 origin 远程进行拉取/推送。
- 多远程配置（origin + old-origin）是团队迁移过程中的过渡形态，新提交应推送到 GitLab origin。

### 验证提示
- 若新增 CI/CD 或 Webhook，需指向 `gitlab.caijj.net` 域名。