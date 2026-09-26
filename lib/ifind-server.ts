import type { NewsArticle, NewsResult } from "./news";
import { dateLabel } from "./market-analysis";

const endpoint = "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-news-mcp";
const unavailable = (code: string, message: string): NewsResult => ({ status: "unavailable", code, message });
type Rpc = { id?: number; result?: any; error?: { code?: number; message?: string } };
class NewsError extends Error { constructor(public code: string, message: string) { super(message); } }

// Streamable HTTP may return a JSON body or an SSE message. Stop at the matching
// response rather than waiting for an open event stream to end.
export async function readMcpResponse(response: Response, id: number): Promise<Rpc> {
  if (response.headers.get("content-type")?.includes("application/json")) {
    const raw = await response.text(); if (raw.length > 250000) throw Error("SIZE");
    const data = JSON.parse(raw); if (data.id !== id) throw Error("RPC_ID"); return data;
  }
  const reader = response.body?.getReader(); if (!reader) throw Error("EMPTY");
  const decoder = new TextDecoder(); let buffer = "", total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > 250000) throw Error("SIZE");
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, split); buffer = buffer.slice(split + 2);
        const payload = event.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!payload) continue;
        const message = JSON.parse(payload) as Rpc; if (message.id === id) return message;
      }
    }
    throw Error("NO_RESPONSE");
  } finally { await reader.cancel().catch(() => {}); }
}

export function newsLinks(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s<>"）)\]，。\\]+/g) || [];
  return [...new Set(urls)].filter(raw => {
    try { const u = new URL(raw); return !u.username && !u.password && u.hostname.includes(".") && !u.hostname.endsWith(".local") &&
      !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname) &&
      !/(?:token|key|authorization|cookie|secret)=/i.test(u.search); } catch { return false; }
  }).slice(0, 10);
}

export function parseNewsContent(raw: string, from: string, to: string): NewsArticle[] {
  const envelope = JSON.parse(raw);
  if (envelope.code !== 1 || envelope.msg !== "success") throw new NewsError("TOOL_ERROR", "新闻检索未成功，不能生成事件结论。");
  const rows = typeof envelope.data?.data === "string" ? JSON.parse(envelope.data.data) : envelope.data?.data;
  if (!Array.isArray(rows)) throw new NewsError("SCHEMA_CHANGED", "新闻响应格式变化，暂停解读。");
  const articles: NewsArticle[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row["资讯标题"] !== "string" || typeof row["资讯内容"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row["日期"])) continue;
    if (row["日期"] < from || row["日期"] > to) continue;
    const title = row["资讯标题"].slice(0,240), excerpt = row["资讯内容"].slice(0,2200), publishedAt = row["日期"];
    if (!title || !excerpt || seen.has(title + publishedAt)) continue;
    seen.add(title + publishedAt);
    const url = typeof row.URL === "string" ? newsLinks(row.URL)[0] || null : null;
    const warnings = ["媒体报道片段，未独立核实原文；发表日期不一定是事件发生日期。"];
    if (!url) warnings.push("原文链接未返回或不可用，溯源资料不完整。");
    // Flag conflicting same-period revenue claims within one excerpt, without
    // choosing a winner or changing the source text.
    const revenues = [...excerpt.matchAll(/动力电池(?:系统)?(?:业务)?(?:的)?(?:营业)?收入为?\s*([\d.]+)\s*亿元/g)].map(m => Number(m[1]));
    if (revenues.length > 1 && Math.max(...revenues) / Math.min(...revenues) > 1.1)
      warnings.push("同一片段出现不同的动力电池收入数值，期间或业务归属待核对；不能据此计算或下结论。");
    if (/观点|分析称|认为|看法|表示|据报道|外媒/.test(excerpt)) warnings.push("片段含转述或观点，需与公司公告交叉核验。");
    articles.push({ id: "", title, excerpt, publishedAt, url, source: url ? new URL(url).hostname : "iFinD 检索片段", warnings });
  }
  return articles.sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0,5).map((a,i) => ({...a,id:`N${String(i+1).padStart(2,"0")}`}));
}

async function queryNews(key: string): Promise<NewsResult> {
  const signal = AbortSignal.timeout(20000);
  let session: string | null = null, sequence = 0;
  let phase = "initialize";
  const headers = () => ({ "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    Authorization: key, ...(session ? { "Mcp-Session-Id": session } : {}) });
  const send = async (body: string) => process.env.IFIND_TRANSPORT === "direct-tls"
    ? (await import("./ifind-transport")).postIfindMcp(headers(), body, signal)
    : fetch(endpoint, {method:"POST",headers:headers(),body,signal,redirect:"manual"});
  async function call(method: string, params: unknown): Promise<any> {
    phase = `${method}:request`;
    const id = ++sequence;
    const r = await send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    if (r.status === 401 || r.status === 403) { await r.body?.cancel(); throw new NewsError("AUTH_REQUIRED", "iFinD 新闻授权未通过，请检查个人令牌及新闻服务权限。"); }
    if (r.status === 429) { await r.body?.cancel(); throw new NewsError("RATE_LIMIT", "iFinD 新闻服务限流，请稍后重试。"); }
    if (!r.ok) { await r.body?.cancel(); throw new NewsError("UPSTREAM_ERROR", "iFinD 新闻服务暂时不可用。"); }
    session = r.headers.get("mcp-session-id") || session;
    phase = `${method}:response`;
    const rpc = await readMcpResponse(r, id);
    if (rpc.error) throw new NewsError("MCP_ERROR", "iFinD 未完成此次查询，请检查服务权限或稍后重试。");
    return rpc.result;
  }
  try {
    await call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "zhengyan-local-research", version: "0.1.0" } });
    phase = "notifications/initialized";
    const ready = await send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    await ready.body?.cancel();
    if (!ready.ok) throw new NewsError("MCP_ERROR", "iFinD 会话初始化未完成。");
    const listing = await call("tools/list", {});
    const candidates = Array.isArray(listing?.tools) ? listing.tools : [];
    const tool = candidates.find((t: any) => /^(?:news_data|news_search|search_news|get_news)$/.test(t?.name));
    if (!tool) throw new NewsError("SCHEMA_CHANGED", "新闻工具清单已变化，需核对接入配置；暂不生成新闻结论。");
    const properties = tool.inputSchema?.properties || {};
    const queryKey = ["query", "question", "input", "prompt"].find(key => properties[key]?.type === "string");
    const supported = [queryKey, "size", "time_start", "time_end"];
    if (!queryKey || (tool.inputSchema?.required || []).some((key: string) => !supported.includes(key)))
      throw new NewsError("SCHEMA_CHANGED", "新闻工具参数需要适配，暂不生成新闻结论。");
    const to = dateLabel(Date.now()), from = dateLabel(Date.now() - 6 * 86400000);
    const query = "宁德时代（300750.SZ）动力电池、储能业务与公司重大事件的最新公开新闻";
    const args = { [queryKey]: query, ...(properties.size ? {size:5} : {}), ...(properties.time_start ? {time_start:from} : {}), ...(properties.time_end ? {time_end:to} : {}) };
    const result = await call("tools/call", { name: tool.name, arguments: args });
    if (result?.isError) throw new NewsError("TOOL_ERROR", "iFinD 新闻检索失败，未将错误内容当作新闻。");
    const parts = Array.isArray(result?.content) ? result.content.filter((v: any) => v.type === "text" && typeof v.text === "string").map((v: any) => v.text) : [];
    const raw = parts.join("\n").trim();
    if (!raw || /(?:authentication failed|permission denied|invalid.{0,5}token|无权限|未授权|额度不足)/i.test(raw))
      throw new NewsError("NO_DATA", "iFinD 未返回可用新闻，请检查授权、额度或检索范围。");
    if (raw.includes(key) || raw.includes(key.replace(/^Bearer\s+/i, ""))) throw Error("SECRET_ECHO");
    // This is the retrieval result, not independently verified article truth.
    const articles = parseNewsContent(raw, from, to);
    if (!articles.length) return unavailable("NO_RESULTS", "本次时间范围没有返回可用新闻片段，不代表没有事件发生。");
    const text = articles.map(a => `${a.id} ${a.title}\n发表日期：${a.publishedAt}；来源：${a.source}\n${a.excerpt}\n核验提示：${a.warnings.join(" ")}\n原文：${a.url || "未提供"}`).join("\n\n");
    return { status: "ok", text, articles, fetchedAt: Date.now(), from, to, tool: tool.name, links: articles.flatMap(a => a.url ? [a.url] : []) };
  } catch (error) {
    if (error instanceof NewsError) return unavailable(error.code, error.message);
    console.warn("ifind_connection_failure", phase, error instanceof Error ? error.message.replaceAll(key, "[redacted]").slice(0, 240) : "unknown");
    return unavailable(signal.aborted ? "TIMEOUT" : "CONNECTION_ERROR", signal.aborted ? "新闻查询超时，请稍后重试。" : "iFinD 连接或响应异常，暂未获得可用新闻。");
  }
}
let cache: { key: string; until: number; result: NewsResult } | undefined;
let pending: { key: string; promise: Promise<NewsResult> } | undefined;
export async function getNewsEvidence(): Promise<NewsResult> {
  const key = process.env.IFIND_API_KEY?.trim();
  if (!key) return unavailable("NOT_CONFIGURED", "iFinD 新闻待授权；当前没有取得新闻，不能据此判断没有事件发生。");
  if (cache?.key === key && cache.until > Date.now()) return cache.result;
  if (pending?.key === key) return pending.promise;
  const promise = queryNews(key).then(result => {
    cache = { key, result, until: Date.now() + (result.status === "ok" ? 300000 : result.code === "RATE_LIMIT" ? 60000 : 10000) }; return result;
  });
  const current = { key, promise }; pending = current;
  try { return await promise; } finally { if (pending === current) pending = undefined; }
}
