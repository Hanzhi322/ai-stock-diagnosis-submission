import { chatBoundaryReply, buildChatPrompt, parseChatMessages, parseChatReply } from "@/lib/stock-chat";
import { getMarketQuote } from "@/lib/market-server";
import { getPriceHistory, getValuation } from "@/lib/market-analysis-server";
import { getNewsEvidence } from "@/lib/ifind-server";
import { neededResearch, type ChatContext } from "@/lib/chat-context";

const headers = { "Cache-Control": "no-store" };
function error(message: string, code: string, status: number, retryAfterSeconds?: number) {
  return Response.json({ error: message, code, ...(retryAfterSeconds ? {retryAfterSeconds} : {}) }, { status, headers: {...headers,...(retryAfterSeconds ? {"Retry-After":String(retryAfterSeconds)} : {})} });
}

export async function POST(request: Request) {
  // Local opt-in only. A deployment without this flag exposes no chat endpoint.
  if (process.env.ENABLE_CHAT_PREVIEW !== "true") return error("对话试验尚未启用。", "PREVIEW_DISABLED", 404);
  if (Number(request.headers.get("content-length")) > 80000) return error("对话内容过长。", "TOO_LARGE", 413);
  let raw: string;
  try { raw = await request.text(); } catch { return error("无法读取请求。", "INVALID_REQUEST", 400); }
  if (new TextEncoder().encode(raw).length > 80000) return error("对话内容过长。", "TOO_LARGE", 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return error("请求格式不正确。", "INVALID_REQUEST", 400); }
  const messages = parseChatMessages(body);
  if (!messages) return error("请输入有效问题（最多 1000 字），或开启新对话后重试。", "INVALID_REQUEST", 400);
  const boundary = chatBoundaryReply(messages[messages.length - 1].content);
  if (boundary) return Response.json(boundary, { headers });
  if (!process.env.LLM_API_KEY) return error("对话模型尚未配置，请先使用工作台里的证据清单。", "NOT_CONFIGURED", 503);
  const endpoint = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
  try { if (new URL(endpoint).protocol !== "https:") throw new Error(); }
  catch { return error("对话模型配置需要检查。", "CONFIG_ERROR", 503); }
  const question = messages[messages.length - 1].content;
  const needs = neededResearch(messages.filter(m => m.role === "user").slice(-2).map(m => m.content).join("\n"));
  const [market, history, valuation, news] = await Promise.all([
    getMarketQuote(), needs.history ? getPriceHistory() : undefined,
    needs.valuation ? getValuation() : undefined, needs.news ? getNewsEvidence() : undefined,
  ]);
  const context: ChatContext = { ...(history ? {history} : {}), ...(valuation ? {valuation} : {}), ...(news ? {news} : {}) };
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  const model = process.env.LLM_MODEL || "openai/gpt-oss-120b";
  const modelRequest = {
    model, temperature: 0, max_tokens: model.startsWith("openai/gpt-oss-") ? 2000 : 1000,
    ...(model.startsWith("openai/gpt-oss-") ? {reasoning_effort:"low"} : {}),
    response_format: { type: "json_object" }, messages: [{ role: "system", content: buildChatPrompt(market, context, question) }, ...messages],
  };
  let payload = JSON.stringify(modelRequest);
  let repaired = false;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(endpoint.replace(/\/$/, "") + "/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
        body: payload, signal,
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after") ?? attempt + 1);
        await response.body?.cancel();
        if (attempt === 2 || !Number.isFinite(seconds) || seconds < 0 || seconds > 20)
          return error("模型调用额度或请求频率暂时受限，问题已保留，请等待后重试。", "RATE_LIMIT", 429, Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 30);
        await new Promise<void>((resolve, reject) => {
          signal.throwIfAborted();
          const abort = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, seconds * 1000);
          signal.addEventListener("abort", abort, { once: true });
        });
        signal.throwIfAborted();
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); return error("模型暂时不可用，请重试。未生成新的回答。", "UPSTREAM_ERROR", 502); }
      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      let parsed: unknown;
      try { parsed = JSON.parse(data.choices?.[0]?.message?.content || "null"); } catch { parsed = null; }
      const reply = parseChatReply(parsed, market, context);
      if (!reply) {
        // One bounded format repair; unvalidated prose is never shown to the user.
        if (!repaired && attempt < 2) {
          repaired = true;
          payload = JSON.stringify({ ...modelRequest, messages: [...modelRequest.messages,
            { role: "assistant", content: (data.choices?.[0]?.message?.content || "{}").slice(0,6000) },
            { role: "user", content: "上轮格式校验未通过。请针对原问题重新输出规定JSON：answer、kind、evidenceIds、followups。公司介绍可以只写简单业务解释并引用C01。没有公司依据时kind选concept或unknown。金额、百分比与日期必须使用系统提供的{{key}}，也可完全不写数字。不要照抄资料中的原始日期字符串。禁止网址和交易建议；拒绝时仅说‘不能提供交易指令’。引用仅限本轮系统已有编号：quote必须M01、history必须H01、valuation必须V01。followups最多两句普通中文，不含数字或占位符。" },
          ] });
          continue;
        }
        return error("模型回答中仍有无法对应来源的内容，自动修复未成功。问题已保留，可以重试。", "VALIDATION", 502);
      }
      return Response.json(reply, { headers });
    }
  } catch (cause) {
    const aborted = request.signal.aborted;
    return error(aborted ? "已停止本次回答。" : signal.aborted || cause instanceof Error && cause.name === "TimeoutError" ?
      "模型响应超时，你的问题已保留，可以重试。" : "连接模型失败，请稍后重试。", aborted ? "CANCELLED" : "CONNECTION_ERROR", aborted ? 499 : 503);
  }
  return error("模型暂时不可用，请重试。", "UPSTREAM_ERROR", 502);
}
