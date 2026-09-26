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

// Only simple lookups use this path. Analysis, other securities, historical
// periods and user-supplied numbers remain outside the deterministic query.
export function quoteQueryFields(question: string): string[] | null {
  const query = question.trim().replace(/[\s，,。！？!?：:～~]/g, "")
    .replace(/^(?:(?:你好|您好|请问|请|帮我|帮忙|麻烦|查一下|查查|查询|看看|看一下|告诉我|想知道|我想知道|那|再|现在|目前|最新|今天|今日|当前|实时|宁德时代|CATL|300750(?:\.SZ)?|这家公司|这只股票|这只股|它|的|A股))+/i, "")
    .replace(/(?:谢谢|呀|啊|呢|吗|嘛|吧|哈|了)+$/g, "");
  if (/^(?:股价|价格|现价|成交价|最新成交价|报价|行情)(?:现在|目前|最新|今天|当前)?(?:是|为|有)?(?:多少(?:钱|元)?|几块钱?|几元)?$/.test(query) || /^(?:一股多少钱|多少钱一股|报个价)$/.test(query))
    return ["lastPrice", "change", "changePct"];
  const fields: [RegExp, string[]][] = [
    [/^(?:涨跌幅|涨幅|跌幅|涨了|跌了|涨跌|涨|跌)(?:是|为|有)?(?:多少|几个点|多少个点)?$/, ["change", "changePct"]],
    [/^(?:成交量|成交了多少股|成交多少股)(?:是|为|有)?(?:多少)?$/, ["volume"]],
    [/^成交额(?:是|为|有)?(?:多少(?:钱)?)?$/, ["turnover"]],
    [/^(?:开盘价|开盘|今开)(?:是|为)?(?:多少(?:钱)?)?$/, ["open"]],
    [/^(?:最高价|最高)(?:是|为)?(?:多少(?:钱)?)?$/, ["high"]],
    [/^(?:最低价|最低)(?:是|为)?(?:多少(?:钱)?)?$/, ["low"]],
    [/^(?:前收盘价|前收|昨收)(?:是|为)?(?:多少(?:钱)?)?$/, ["previousClose"]],
  ];
  return fields.find(([pattern]) => pattern.test(query))?.[1] ?? null;
}
