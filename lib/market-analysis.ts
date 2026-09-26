export const historyDocs = "https://fuyao.aicubes.cn/docs/api-reference/prices/";
export const valuationDocs = "https://fuyao.aicubes.cn/docs/api-reference/valuations/";
export type Unavailable = { status: "unavailable"; code: string; message: string };
export type Bar = { date: number; close: number };
export type HistoryResult = Unavailable | { status: "ok"; bars: Bar[]; fetchedAt: number; sourceTimestamp: number | null;
  requestId: string | null; changePct: number; maxDrawdownPct: number; start: number; end: number; count: number };
export type ValuationResult = Unavailable | { status: "ok"; fetchedAt: number; sourceTimestamp: number | null; requestId: string | null;
  pe_ttm: number | null; pe_mrq: number | null; pb_mrq: number | null; ps_ttm: number | null; pcf_ttm: number | null };
export type MarketAnalysis = { history: HistoryResult; valuation: ValuationResult };
export const dateLabel = (ms: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(ms);
export function historyMetrics(bars: Bar[]) {
  let peak = bars[0].close, maxDrawdownPct = 0;
  for (const bar of bars) { peak = Math.max(peak, bar.close); maxDrawdownPct = Math.min(maxDrawdownPct, (bar.close / peak - 1) * 100); }
  return { changePct: (bars.at(-1)!.close / bars[0].close - 1) * 100, maxDrawdownPct,
    start: bars[0].date, end: bars.at(-1)!.date, count: bars.length };
}
