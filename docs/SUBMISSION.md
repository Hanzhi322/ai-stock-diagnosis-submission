# 证研 · 提交清单

题目：个股多维诊断与证据验证。研究对象：宁德时代（300750.SZ）。

## 必交材料

1. **Web 产品**：[在线访问证研](https://zhengyan-evidence-workbench.zuhanzhizzz.chatgpt.site/)。公开访问，无需评审提供模型或金融数据密钥。
2. **源码仓库与 README**：[Hanzhi322/ai-stock-diagnosis-submission](https://github.com/Hanzhi322/ai-stock-diagnosis-submission)。默认分支 main；根目录 README 包含启动、环境变量、产品选择、AI 角色、数据来源、已知边界和未做事项。
3. **AI 使用与验证记录**：`docs/AI_USAGE.md`。
4. **测试说明**：`docs/TESTING.md`；本次实际验证摘要见 `docs/VERIFICATION.json`。

## 建议验收路径

打开网页 → 点击综合诊断 → 查看 AI 解读和本轮资料状态 → 打开一条财务矛盾证据及一条市场/新闻证据 → 核对原始字段、期间与来源 → 用“问问证研”追问。

## 附件内容

提交压缩包包含源代码、README、以上说明和环境变量空示例。包内不含密钥、node_modules、Git 元数据、构建缓存或调试记录。模型、行情与新闻需要服务端权限，缺失或失败时会明确提示。

演示视频为可选项，未将视频列为已交付。`docs/DEMO.md` 提供演示顺序。

## 当前验收边界

真实 Groq 诊断与聊天、扶摇价格/日线/估值及 iFinD 新闻已在线上验证。接口仍受服务商授权、额度与网络影响；失败时页面明确显示缺口，详见测试说明与验证记录。
