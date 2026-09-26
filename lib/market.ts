// Browser-safe types and formatting. Credentials and provider calls live in market-server.ts.
export const marketSource = "同花顺 · 扶摇";
export const marketDocs = "https://fuyao.aicubes.cn/docs/api-reference/prices/";
export type MarketQuote = {
  symbol: "300750.SZ"; currency: "CNY"; lastPrice: number;
  change: number | null; changePct: number | null;
  open: number | null; high: number | null; low: number | null; previousClose: number | null;
  volume: number | null; turnover: number | null;
  sourceTimestamp: number | null; fetchedAt: number;
  requestId: string | null;
};
export type MarketResult =
  | { status: "ok"; quote: MarketQuote; cached: boolean }
  | { status: "unavailable"; code: string; message: string; retryAfterSeconds?: number };

export function quoteTime(timestamp: number | null) {
  if (timestamp === null) return "上游未提供时间";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(timestamp));
}

export function quoteFreshness(quote: MarketQuote, now = Date.now()) {
  if (quote.sourceTimestamp === null) return "unknown" as const;
  return now - quote.sourceTimestamp > 15 * 60 * 1000 ? "older" as const : "recent" as const;
}

export function quoteNotice(quote: MarketQuote) {
  const freshness = quoteFreshness(quote);
  return freshness === "unknown" ? "上游未提供行情时点，无法确认是否为当前价格。" :
    freshness === "older" ? "行情时点早于本次查询；可能处于休市或数据延迟，请按标注时点理解。" :
      "展示接口返回的行情快照，可能存在延迟，不代表逐笔实时推送。";
}
