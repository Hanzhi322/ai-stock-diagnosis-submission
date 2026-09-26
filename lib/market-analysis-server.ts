import { historyMetrics, type Bar, type HistoryResult, type ValuationResult, type Unavailable } from "./market-analysis";
const bad = (code: string, message: string): Unavailable => ({ status: "unavailable", code, message });
function providerError(code: unknown) {
  return bad(code === 2001 ? "AUTH_REQUIRED" : code === 2003 ? "FORBIDDEN" : code === 4001 ? "RATE_LIMIT" : "PROVIDER_ERROR",
    code === 2003 ? "当前凭证无此项数据权限。" : code === 4001 ? "数据服务限流，请稍后刷新。" : "数据未取得，请检查连接或配置后重试。");
}
function metadata(v: Record<string, any>, fetchedAt: number) {
  const timestamp = v.data?.timestamp ?? null;
  if (timestamp !== null && (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp < 946684800000 || timestamp > fetchedAt + 60000)) throw Error();
  return { fetchedAt, sourceTimestamp: timestamp as number | null, requestId: typeof v.request_id === "string" && /^[\w-]{1,128}$/.test(v.request_id) ? v.request_id : null };
}
export function parseHistory(value: unknown, now = Date.now()): HistoryResult {
  if (!value || typeof value !== "object") return bad("INVALID_DATA", "历史行情格式异常。");
  const v = value as Record<string, any>;
  if (v.code !== 0) return providerError(v.code);
  try {
    if (!Array.isArray(v.data?.item)) throw Error();
    if (v.data.item.length < 2) return bad("NO_DATA", "有效日线不足，不能计算区间指标。");
    const seen = new Set<number>();
    const bars: Bar[] = v.data.item.map((x: Record<string, unknown>) => {
      if (!x || typeof x.date_ms !== "number" || !Number.isFinite(x.date_ms) || x.date_ms < now - 95 * 86400000 || x.date_ms > now || seen.has(x.date_ms) ||
        typeof x.close_price !== "number" || !Number.isFinite(x.close_price) || x.close_price <= 0) throw Error();
      seen.add(x.date_ms); return { date: x.date_ms, close: x.close_price };
    }).sort((a: Bar, b: Bar) => a.date - b.date).slice(-60);
    return { status: "ok", bars, ...metadata(v, now), ...historyMetrics(bars) };
  } catch { return bad("INVALID_DATA", "日线日期、价格或重复记录异常，暂停区间计算。"); }
}
export function parseValuation(value: unknown, now = Date.now()): ValuationResult {
  if (!value || typeof value !== "object") return bad("INVALID_DATA", "估值数据格式异常。");
  const v = value as Record<string, any>;
  if (v.code !== 0) return providerError(v.code);
  try {
    const rows = v.data?.item?.filter((x: { thscode?: string }) => x?.thscode === "300750.SZ");
    if (!rows?.length) return bad("NO_DATA", "估值服务未返回宁德时代数据。");
    if (rows.length !== 1) throw Error();
    const keys = ["pe_ttm", "pe_mrq", "pb_mrq", "ps_ttm", "pcf_ttm"] as const;
    const values = Object.fromEntries(keys.map(key => {
      const val = rows[0][key] ?? null;
      if (val !== null && (typeof val !== "number" || !Number.isFinite(val))) throw Error();
      return [key, val];
    })) as Pick<Extract<ValuationResult, {status:"ok"}>, typeof keys[number]>;
    if (Object.values(values).every(v => v === null)) return bad("NO_DATA", "估值指标均未获得，不能形成正常估值结论。");
    return { status: "ok", ...values, ...metadata(v, now) };
  } catch { return bad("INVALID_DATA", "估值字段或时点异常，暂停展示。"); }
}
const caches = new Map<string, { key: string; until: number; value: HistoryResult | ValuationResult }>();
const pending = new Map<string, { key: string; promise: Promise<HistoryResult | ValuationResult> }>();
async function load(kind: "history" | "valuation"): Promise<HistoryResult | ValuationResult> {
  const key = process.env.FUYAO_API_KEY?.trim();
  if (!key) return bad("NOT_CONFIGURED", "扶摇数据服务尚未配置。");
  const cache = caches.get(kind);
  if (cache?.key === key && cache.until > Date.now()) return cache.value;
  const inflight = pending.get(kind); if (inflight?.key === key) return inflight.promise;
  const now = Date.now();
  const url = kind === "valuation" ? "https://fuyao.aicubes.cn/api/a-share/valuations/snapshot?thscodes=300750.SZ" :
    `https://fuyao.aicubes.cn/api/a-share/prices/historical?thscode=300750.SZ&interval=1d&adjust=forward&start=${now - 90 * 86400000}&end=${now}`;
  const promise = (async () => {
    let result: HistoryResult | ValuationResult;
    let cooldown = 10000;
    try {
      const r = await fetch(url, { headers: { "X-api-key": key }, signal: AbortSignal.timeout(10000), cache: "no-store" });
      if (r.status === 429) { const retry = Number(r.headers.get("retry-after") ?? 60); cooldown = (Number.isFinite(retry) && retry > 0 ? retry : 60) * 1000; }
      if (!r.ok) { await r.body?.cancel(); result = providerError(r.status === 429 ? 4001 : r.status === 403 ? 2003 : r.status === 401 ? 2001 : null); }
      else {
        const raw = await r.text(); if (raw.length > 250000) throw Error();
        result = kind === "history" ? parseHistory(JSON.parse(raw)) : parseValuation(JSON.parse(raw));
        if (result.status === "unavailable" && result.code === "RATE_LIMIT") cooldown = 60000;
      }
    } catch { result = bad("CONNECTION_ERROR", "数据查询超时或连接失败，没有使用模拟数据替代。"); }
    caches.set(kind, { key, until: Date.now() + (result.status === "ok" ? kind === "history" ? 300000 : 60000 : cooldown), value: result });
    return result;
  })();
  const current = { key, promise }; pending.set(kind, current);
  try { return await promise; } finally { if (pending.get(kind) === current) pending.delete(kind); }
}
export const getPriceHistory = () => load("history") as Promise<HistoryResult>;
export const getValuation = () => load("valuation") as Promise<ValuationResult>;
