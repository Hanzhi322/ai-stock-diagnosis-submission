import type { MarketQuote, MarketResult } from "./market";

const endpoint = "https://fuyao.aicubes.cn/api/a-share/prices/snapshot?thscodes=300750.SZ";
const cacheDuration = 30000;
let cache: { credential: string; expiresAt: number; result: MarketResult } | undefined;
let pending: { credential: string; promise: Promise<MarketResult> } | undefined;
const unavailable = (code: string, message: string, retryAfterSeconds?: number): MarketResult =>
  ({ status: "unavailable", code, message, ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) });

export function parseMarketPayload(payload: unknown, fetchedAt = Date.now()): MarketResult {
  if (!payload || typeof payload !== "object") return unavailable("INVALID_DATA", "行情返回格式异常，暂不显示价格。");
  const v = payload as { code?: unknown; data?: { timestamp?: unknown; item?: unknown }; request_id?: unknown };
  if (v.code !== 0) {
    if (v.code === 2001) return unavailable("AUTH_REQUIRED", "行情服务的访问凭证缺失或无效，请完成配置后刷新。");
    if (v.code === 2003) return unavailable("FORBIDDEN", "当前行情凭证没有此接口的访问权限。");
    if (v.code === 4001) return unavailable("RATE_LIMIT", "行情服务繁忙，请稍后刷新。", 60);
    if (v.code === 3001 || v.code === 3002) return unavailable("NO_DATA", "行情服务暂未返回这只股票的数据。");
    return unavailable("PROVIDER_ERROR", "行情服务暂时不可用，请稍后刷新。");
  }
  if (!Array.isArray(v.data?.item)) return unavailable("INVALID_DATA", "行情返回格式异常，暂不显示价格。");
  const items = v.data.item.filter(item => item && item.thscode === "300750.SZ");
  if (items.length !== 1) return unavailable("NO_DATA", "未获得宁德时代的有效行情，暂不显示价格。");
  const item = items[0] as Record<string, unknown>;
  try {
    const number = (key: string, allowNegative = false): number | null => {
      const value = item[key];
      if (value === null || value === undefined) return null;
      if (typeof value !== "number" || !Number.isFinite(value) || !allowNegative && value < 0) throw new Error();
      return value;
    };
    const lastPrice = number("last_price");
    if (lastPrice === null || lastPrice <= 0) return unavailable("NO_DATA", "未获得有效成交价，暂不显示价格。");
    const sourceTimestamp = v.data.timestamp ?? null;
    if (sourceTimestamp !== null && (typeof sourceTimestamp !== "number" || !Number.isFinite(sourceTimestamp) ||
      sourceTimestamp < 946684800000 || sourceTimestamp > fetchedAt + 60000)) throw new Error();
    const quote: MarketQuote = {
      symbol: "300750.SZ", currency: "CNY", lastPrice,
      change: number("price_change", true), changePct: number("price_change_ratio_pct", true),
      open: number("open_price"), high: number("high_price"), low: number("low_price"), previousClose: number("prev_price"),
      volume: number("volume"), turnover: number("turnover"), sourceTimestamp: sourceTimestamp as number | null, fetchedAt,
      requestId: typeof v.request_id === "string" && /^[\w-]{1,128}$/.test(v.request_id) ? v.request_id : null,
    };
    if (quote.high !== null && quote.low !== null && quote.high < quote.low) throw new Error();
    return { status: "ok", quote, cached: false };
  } catch { return unavailable("INVALID_DATA", "行情字段或时间异常，暂不显示价格。"); }
}

async function fetchQuote(key: string): Promise<MarketResult> {
  try {
    const response = await fetch(endpoint, { headers: { "X-api-key": key }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after") ?? 60);
      await response.body?.cancel();
      return unavailable("RATE_LIMIT", "行情请求过于频繁，请稍后刷新。", Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60);
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return unavailable(response.status === 401 ? "AUTH_REQUIRED" : "FORBIDDEN", "行情凭证无效或缺少访问权限，请检查配置。");
    }
    if (!response.ok) { await response.body?.cancel(); return unavailable("PROVIDER_ERROR", "行情服务暂时不可用，请稍后刷新。"); }
    const raw = await response.text();
    if (raw.length > 100000) return unavailable("INVALID_DATA", "行情响应异常，暂不显示价格。");
    return parseMarketPayload(JSON.parse(raw));
  } catch (error) {
    return unavailable(error instanceof Error && error.name === "TimeoutError" ? "TIMEOUT" : "CONNECTION_ERROR",
      "未能获取行情，请稍后刷新。不会使用模拟价格替代。");
  }
}

export async function getMarketQuote(): Promise<MarketResult> {
  const key = process.env.FUYAO_API_KEY?.trim();
  if (!key) return unavailable("NOT_CONFIGURED", "行情服务待配置，暂未取得价格。");
  if (cache?.credential === key && cache.expiresAt > Date.now()) {
    return cache.result.status === "ok" ? { ...cache.result, cached: true } : cache.result;
  }
  if (pending?.credential === key) return pending.promise;
  const promise = fetchQuote(key).then(result => {
    cache = { credential: key, result, expiresAt: Date.now() + (result.status === "ok" ? cacheDuration :
      result.code === "RATE_LIMIT" ? (result.retryAfterSeconds ?? 60) * 1000 : 5000) };
    return result;
  });
  const current = { credential: key, promise }; pending = current;
  try { return await promise; } finally { if (pending === current) pending = undefined; }
}
