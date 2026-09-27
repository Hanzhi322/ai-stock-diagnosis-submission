import { chatBoundaryReply, buildChatPrompt, buildQuoteReply, parseChatMessages } from "@/lib/stock-chat";
import { quoteQueryFields } from "@/lib/market";
import { getMarketQuote } from "@/lib/market-server";
import { getPriceHistory, getValuation } from "@/lib/market-analysis-server";
import { neededResearch, type ChatContext } from "@/lib/chat-context";
import { getIfindResearch, mergeResearch } from "@/lib/ifind-research-server";
import { isSimpleChat, researchTools, type ResearchTool } from "@/lib/ifind-research";
import { evidenceFallback, inspectChatAnswer } from "@/lib/chat-answer";
import { logUpstreamFailure, modelFailureMessage, readUpstreamError } from "@/lib/upstream-failure";
import { modelOutputOptions, usesCompactModelPrompt } from "@/lib/model-options";

const headers = { "Cache-Control": "no-store" };
function error(message: string, code: string, status: number, retryAfterSeconds?: number) {
  return Response.json({ error: message, code, ...(retryAfterSeconds ? {retryAfterSeconds} : {}) }, { status, headers: {...headers,...(retryAfterSeconds ? {"Retry-After":String(retryAfterSeconds)} : {})} });
}

export async function POST(request: Request) {
  // A deployment without this opt-in flag exposes no chat endpoint.
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
  const question = messages[messages.length - 1].content;
  const quoteFields = quoteQueryFields(question);
  if (quoteFields) return Response.json(buildQuoteReply(quoteFields, await getMarketQuote()), { headers });
  if (!process.env.LLM_API_KEY) return error("对话模型尚未配置，请先使用工作台里的证据清单。", "NOT_CONFIGURED", 503);
  const endpoint = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
  try { if (new URL(endpoint).protocol !== "https:") throw new Error(); }
  catch { return error("对话模型配置需要检查。", "CONFIG_ERROR", 503); }
  const researchQuestion = isSimpleChat(question) ? question : messages.filter(m => m.role === "user").slice(-2).map(m => m.content).join("\n");
  const needs = neededResearch(researchQuestion);
  const [market, history, valuation, research] = await Promise.all([
    getMarketQuote(), needs.history ? getPriceHistory() : undefined,
    needs.valuation ? getValuation() : undefined, getIfindResearch(researchQuestion, request.signal),
  ]);
  const context: ChatContext = { ...(history ? {history} : {}), ...(valuation ? {valuation} : {}), ...(research.code!=="NOT_NEEDED"?{research}:{}) };
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  const model = process.env.LLM_MODEL || "openai/gpt-oss-120b";
  const compact = usesCompactModelPrompt(endpoint, model);
  // Same provider and credentials, with the same evidence validation. A fallback
  // is used only for provider failures, never to bypass unsupported content.
  const fallbackModel = new URL(endpoint).hostname === "api.groq.com" && model === "openai/gpt-oss-120b" ? "openai/gpt-oss-20b" : null;
  let activeModel = model;
  // Keep the immediately preceding exchange for pronouns/follow-ups. Older
  // assistant narratives are not an authority for the current stock facts.
  const conversation=messages.slice(-3);
  const modelRequest = {
    model, temperature: 0, ...modelOutputOptions(endpoint, model, 1000),
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: buildChatPrompt(market, context, researchQuestion, compact) }, ...conversation],
  };
  let payload = JSON.stringify(modelRequest);
  let repaired = false;
  let supplemented = false;
  let rateRetries = 0;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(endpoint.replace(/\/$/, "") + "/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
        body: payload, signal,
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after") ?? attempt + 1);
        await response.body?.cancel();
        if (fallbackModel && activeModel !== fallbackModel) {
          activeModel = fallbackModel;
          payload = JSON.stringify({...JSON.parse(payload),model:activeModel});
          continue;
        }
        if (rateRetries++ >= 2 || attempt === 4 || !Number.isFinite(seconds) || seconds < 0 || seconds > 20)
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
      let data: { choices?: { message?: { content?: string } }[] };
      if (!response.ok) {
        // Groq can return useful text with a serialization error. It goes
        // through the same paragraph inspection/repair as a 200 response.
        const failure=await readUpstreamError(response) as {error?:{code?:string;failed_generation?:string}}|null;
        if(response.status===400&&failure?.error?.code==="json_validate_failed"&&typeof failure.error.failed_generation==="string"){
          data={choices:[{message:{content:failure.error.failed_generation}}]};
        }else {
          const detail=logUpstreamFailure("model","chat/completions",response.status,failure);
          return error(modelFailureMessage(detail), `UPSTREAM_${response.status}`, 502);
        }
      }else data = await response.json();
      let parsed: unknown;
      try { parsed = JSON.parse((data.choices?.[0]?.message?.content || "null").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")); } catch { parsed = null; }
      const lookup = parsed && typeof parsed === "object" ? (parsed as {lookup?:{tool?:unknown;query?:unknown}}).lookup : undefined;
      if(lookup && !supplemented && attempt<4 && researchTools.includes(lookup.tool as ResearchTool) && typeof lookup.query==="string" && lookup.query.trim().length>0 && lookup.query.length<=450){
        supplemented=true;
        const extra=await getIfindResearch(question, signal, {tool:lookup.tool as ResearchTool,query:lookup.query});
        context.research=mergeResearch(context.research,extra);
        modelRequest.messages=[{role:"system",content:buildChatPrompt(market,context,researchQuestion,compact)+"\n补查已经完成。请使用当前资料直接回答；无法确认的部分自然说明，不能再次申请lookup。"},...conversation];
        payload=JSON.stringify({...modelRequest,model:activeModel});
        continue;
      }
      const inspected = inspectChatAnswer(parsed, market, context);
      const reply = inspected.reply;
      if (!reply) {
        // Repair the actual failing claims once, with targeted feedback. Keep
        // provider failures separate from answer quality and user-facing text.
        if (!repaired && attempt < 4) {
          repaired = true;
          payload = JSON.stringify({ ...modelRequest, model: activeModel, messages: [...modelRequest.messages,
            { role: "assistant", content: (data.choices?.[0]?.message?.content || "{}").slice(0,6000) },
            { role: "user", content: `请仅针对以下问题调整回答：${inspected.issues.slice(0,3).join("；")}。不要重复整段失败提示。已有来源能支持的部分继续回答，未确认判断自然说明。输出answer、kind、evidenceIds、followups。不要向用户提及这条修正要求，不再申请lookup。` },
          ] });
          continue;
        }
        const fallback=evidenceFallback(question,market,context);
        if(fallback)return Response.json(fallback,{headers});
        return error("这次回答中的关键判断还无法可靠确认，暂时不能给出结论。你可以稍后重试，或先查看相关证据。", "ANSWER_UNCONFIRMED", 502);
      }
      return Response.json({...reply, model: activeModel}, { headers });
    }
  } catch (cause) {
    const aborted = request.signal.aborted;
    return error(aborted ? "已停止本次回答。" : signal.aborted || cause instanceof Error && cause.name === "TimeoutError" ?
      "模型响应超时，你的问题已保留，可以重试。" : "连接模型失败，请稍后重试。", aborted ? "CANCELLED" : "CONNECTION_ERROR", aborted ? 499 : 503);
  }
  return error("模型暂时不可用，请重试。", "UPSTREAM_ERROR", 502);
}
