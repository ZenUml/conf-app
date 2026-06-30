---
name: forge-deploy-ruixiang
description: 当用户要把 Forge 应用构建并部署到自己的 ruixiang 开发环境、装到 danshuitaihejie.atlassian.net 站点时使用此 skill。仅覆盖部署链路（login / 建环境 / build / deploy / install），不涉及 tunnel 本地调试、PR 自检或功能开发。
---

# Forge 部署到 ruixiang 环境

只做一件事：把本地代码推到 `env_ruixiang` 环境,并装到 `danshuitaihejie.atlassian.net` 上。

## 前置

```bash
npm i -g @forge/cli@latest
forge login
```

token 在 https://id.atlassian.com/manage/api-tokens 生成,临时粘贴,**不要**写进仓库。

## 首次接入：建 ruixiang 环境

```bash
forge register                            # 可选:第一次开发时把当前目录注册成 app
forge environments create -e env_ruixiang --verbose
forge settings set default-environment env_ruixiang
```

把 `wrangler.toml` 里的环境变量也对齐到 `env_ruixiang`。

## 部署四步曲

每次发布跑这四条:

```bash
pnpm build:full                                                              # 1. 构建
rm -fr dist/drawio                                                          # 2. 去掉 ~170MB 的 drawio,否则 deploy 会因体积失败
forge deploy -e env_ruixiang                                                # 3. 部署
forge install -p Confluence -s danshuitaihejie.atlassian.net --confirm-scopes --upgrade   # 4. 装站点(第二次起必须 --upgrade)
```

### 体积自检(部署失败时先跑)

```bash
cd dist
du -sh * | sort -rh
zip -r -9 archive.zip ./* > /dev/null && du -h archive.zip && rm archive.zip
```

参考:[Forge deploy gives size related error](https://community.developer.atlassian.com/t/forge-deploy-gives-size-related-error/83364)。

## install 卡住时的排查

如果 install 一直失败,大概率是别的 app id 用过同名 app,污染了站点安装记录。处理路径:

- Atlassian Admin → [Connected apps](https://admin.atlassian.com/s/8cbb8c8c-3a06-4229-ab53-9a5b6f240f2e/user-connected-apps/tab/installed) → 删掉同名残留 → 再 install。
- 站点管理台:https://danshuitaihejie.atlassian.net/wiki/plugins/servlet/upm

## 相关

- 调试请用 `/tunnel` 或另开 skill——本 skill 不覆盖本地实时调试。
- [Forge CLI reference](https://developer.atlassian.com/platform/forge/cli-reference/)