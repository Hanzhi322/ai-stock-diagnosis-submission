# 腾讯云独立部署指南

此副本用于腾讯云 CloudBase 云托管。原 `chatgpt.site` 网站、仓库 `main` 分支及原评审压缩包继续保留；部署此分支不会更新原站。

## 控制台配置

在上海地域的 CloudBase 环境中选择「云函数 / 托管 → 云托管 → 服务管理 → Git 平台部署」。

| 项目 | 填写内容 |
| --- | --- |
| Git 仓库 | `Hanzhi322/ai-stock-diagnosis-submission` |
| 分支 | `deploy/cloudbase` |
| 自动部署 | 关闭，验证后手动发布 |
| 服务名称 | `hanzhi-stockresearch` |
| 服务端口 | `3000`，访问端口保持控制台默认值 |
| 构建目录 / 上下文 | 仓库根目录 `.` |
| Dockerfile | 根目录 `Dockerfile` |

容器使用 Node.js 22 运行完整 Next.js 服务。模型、金融数据、新闻请求在服务端执行；前端继续请求同域名的 `/api/*`。当前未使用 CloudBase 数据库或 SDK，数据库类型不影响应用。

## 环境变量

在服务的「环境变量设置」中配置运行时变量，不要把密钥放进 Dockerfile、Git 仓库、构建参数或截图。

```text
ENABLE_CHAT_PREVIEW=true
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=openai/gpt-oss-120b
LLM_API_KEY=<在控制台安全填写现有 Groq Key>
FUYAO_API_KEY=<在控制台安全填写现有扶摇 Key>
IFIND_API_KEY=<在控制台安全填写现有 iFinD Key>
IFIND_TRANSPORT=fetch
```

`PORT=3000` 和 `HOSTNAME=0.0.0.0` 已在镜像中配置。`.dockerignore` 使用允许列表，所有 `.env*`、私钥、本地依赖与 Git 历史均不进入构建上下文。不要使用 `NEXT_PUBLIC_` 前缀保存密钥。

控制台「可视化输入」的值只填写密钥本身，不包含首尾引号，不包含 `IFIND_API_KEY=` 等变量名。`.env` 文件中的引号是文件语法；复制进控制台时，它们可能变成密钥内容的一部分，导致认证失败。

## 本地验证

```bash
npm ci
npm test
npm run build:cloudbase
HOSTNAME=127.0.0.1 PORT=3000 node --env-file=.env.local .next/standalone/server.js
```

`build:cloudbase` 会使用 Next.js 的 standalone 输出并复制页面所需的静态资源。此命令与原 Sites 的 `build` 命令独立。Docker 在 Linux 环境重新安装锁定依赖，不上传开发机的 `node_modules`。

## 发布后验收

1. 页面、样式和证据抽屉能打开；`/api/status` 正确显示配置状态（不会显示密钥）。
2. 行情与新闻能从新环境真实查询，并显示时间、来源和失败状态。
3. 对话返回真实模型结果，连续追问可用；429 限流、上游超时与缺少密钥时不能冒充模型成功。
4. 国内手机流量和宽带关闭 VPN 后，分别验证网页及后端功能。
5. 完成验收后将腾讯云地址作为额外入口记录；保留原站链接，不能把本地测试写成云端测试通过。

## 当前边界

腾讯云实测（北京时间 2026-09-27）：Docker 镜像构建、服务启动成功。[测试入口](https://hanzhi-stockresearch-320203-5-1369223532.sh.run.tcloudbase.com/)的网页、价格快照、历史行情和估值均取得响应。默认域名可能先展示腾讯云测试域名提示。

目前尚未完成验收的两项：

- 模型：腾讯云 `/api/diagnose` 返回 `failureCode=UPSTREAM_403`，对话返回 502。403 来自模型请求上游，不是回答内容校验，也不是已确认的 429 限流或超时。本地使用现有配置直接调用 Groq 同一模型返回 200 和真实回答，云端被拒绝的具体原因仍需读取运行环境的错误详情。
- 新闻：腾讯云原版本返回 `AUTH_REQUIRED`。旧代码将 401 与 403 合并为这一状态，因此此状态本身不能证明密钥无效。本地 iFinD 新闻与综合金融 MCP 初始化均返回 200。需检查云端运行时配置与服务端请求结果。

运行实例内进一步对照已定位新闻故障：`IFIND_API_KEY` 值额外包含引号，原值请求两个 MCP 服务均返回 401；只在诊断进程内去掉引号后，新闻与金融服务均返回 200，且去引号后的密钥与本地可用配置一致。此诊断不修改服务的实际环境变量，需在控制台去掉引号并更新服务后再验收线上新闻。

同次检查发现腾讯云 `LLM_API_KEY` 与本地已验证可用密钥不一致；Groq 模型清单接口带密钥和不带密钥均返回 403。接下来应先统一为已验证的配置，再检查云端调用。现有响应仅写明 `Forbidden`，不足以确认具体是哪条地区、IP 或账户策略；不得把推测写成已确认根因。

本次在腾讯云分支增加上游错误日志：记录服务、调用阶段、HTTP 状态与脱敏错误信息，401 与 403 分开。公开接口不返回原始上游错误或密钥。控制台日志搜索 `upstream_failure` 可定位失败步骤。此排障修改已经通过 102 项自动化测试及 standalone 生产构建；在腾讯云部署该修改前，旧实例不会产生新增日志。**不能将日志改进当作接口故障已修复。**

本地验证记录（2026-09-26）：98 项自动化测试通过；Next.js 生产构建及构建中的 TypeScript 检查通过；独立服务首页与 8 个页面静态资源返回 200；行情及新闻返回 `status=ok`；公司介绍问答实际调用 Groq，返回 `mode=llm`。源码、前端构建产物及当前 Git 历史扫描未发现现有三项服务密钥或常见令牌格式。以上均为本地验证，不代表腾讯云已部署或国内网络验收完成。

- 腾讯云 Linux 容器已构建并启动；模型与新闻调用仍待排查，国内不同网络访问仍需分别验收。
- 本机未安装 Docker，尚未在本机执行 Docker 镜像构建。
- CloudBase 免费套餐有资源点配额，不能因为环境创建免费就保证长期开机免费。部署前核对实例规格、缩容设置及剩余资源点；需要付费升级时由项目持有人决定。
- 免费版云函数的 3 秒超时不适合当前模型链路，因此此方案使用云托管；这不等于云托管完全没有超时与配额限制。
- 平台默认域名可能展示访问提示中间页，并受到风控限制。正式评审前必须用最终链接验收，不能仅凭平台显示「部署成功」判断可用。

参考：[CloudBase 套餐](https://cloud.tencent.com/document/product/876/127357)、[默认域名限制](https://docs.cloudbase.net/service/alias)、[Next.js 云托管部署](https://docs.cloudbase.net/recipes/deploy-nextjs-to-cloudbase-run)。
