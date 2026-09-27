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
LLM_BASE_URL=https://maas-api.cn-huabei-1.xf-yun.com/v2
LLM_MODEL=spark-x2.5-1.7b
LLM_API_KEY=<在控制台安全填写已授权此模型的讯飞星辰 MaaS Key>
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

## 故障定位与当前状态

腾讯云实测（北京时间 2026-09-27）：Docker 镜像构建、服务启动成功。[测试入口](https://hanzhi-stockresearch-320203-5-1369223532.sh.run.tcloudbase.com/)的网页、价格快照、历史行情和估值均取得响应；版本 002 已恢复新闻检索。默认域名可能先展示腾讯云测试域名提示。

- **iFinD 401 已定位并修复**：控制台 `IFIND_API_KEY` 多带了首尾引号；去除引号并部署后，新闻及金融 MCP 均可调用。
- **Groq 403 仍存在于腾讯云环境**：实例内带密钥和不带密钥访问 Groq 均返回 `Forbidden`，改成已知可用 Key 后仍失败。这是上游访问拒绝，不是回答校验、429 限流或已确认的超时；响应不足以确定具体 IP、地区或账户策略。
- **腾讯云副本改接讯飞星辰 MaaS**：接口和模型 ID 已由账户的「API 调用」示例核对。该 Key 必须有 `Spark-X2.5-1.7B` 授权，不能混用旧版 Spark 的凭证或其他模型套餐 Key。
- **小模型适配**：实测默认推理占用了几乎全部输出额度，导致正文为空。仅对该讯飞模型关闭深度思考、增加正文额度，使用简洁的来源提示与 JSON 示例；继续核验来源和数值。已有局部可确认的句子继续展示，内部修正提示不进入用户正文。推荐追问使用用户口吻。

讯飞本地验收记录见 [模型接入验证](XFYUN_VERIFICATION.md)。**本地通过不等于腾讯云通过：需把最新 `deploy/cloudbase` 代码与以上三项 LLM 变量一起更新到服务，随后执行发布后验收。**现有扶摇、iFinD 变量沿用已经验证可用的值。

## 预算与已知边界

- 讯飞官方在本次核对时将 `Spark-X2.5-1.7B` 标为免费；以账户当前用量、额度和产品页为准。免费不等于无限并发或可用性保障，连续请求可能限流。详见[讯飞官方模型页面](https://spark.xfyun.cn/sparkapi)。
- 这是轻量模型，解释能力与复杂问题的稳定性有限。已取得的财报、行情和新闻仍可独立查看；行情查询可直接使用数据接口。模型服务失败时清楚标明失败或规则降级，不把降级响应记为 AI 成功。
- 自动化测试覆盖主链路、缺失数据、接口失败、错误数值、错误来源与交易边界；实测记录只代表记录中的案例和时点，不保证任意问题都能回答。
- 本机未安装 Docker；已通过本地 Next.js standalone 构建，Linux 镜像构建以腾讯云部署结果为准。
- CloudBase 免费套餐有资源点配额；环境创建免费不代表长期开机免费。需要付费升级时由项目持有人决定。
- 默认域名可能展示中间页并受到访问限制。国内手机流量、宽带关闭 VPN 后的完整问答仍需实际验收，不能只凭「部署成功」判断国内普遍可用。
- 原 GPT Site 继续使用其原有模型配置，本分支不会更新原站、`main` 分支或原提交包。

参考：[CloudBase 套餐](https://cloud.tencent.com/document/product/876/127357)、[默认域名限制](https://docs.cloudbase.net/service/alias)、[Next.js 云托管部署](https://docs.cloudbase.net/recipes/deploy-nextjs-to-cloudbase-run)、[讯飞 MaaS 接口文档](https://www.xfyun.cn/doc/spark/推理服务-http.html)。
