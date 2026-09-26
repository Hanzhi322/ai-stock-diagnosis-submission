"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { fmt } from "@/lib/research";
import { marketSource, marketDocs, quoteTime, quoteNotice, type MarketResult } from "@/lib/market";

export function MarketQuotePanel({ value, onChange }: { value: MarketResult | null; onChange: (value: MarketResult) => void }) {
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      const response = await fetch("/api/quote", { signal: controller.signal });
      const result = await response.json() as MarketResult;
      if (!["ok", "unavailable"].includes(result.status)) throw new Error();
      if (!controller.signal.aborted) onChange(result);
    } catch {
      if (!controller.signal.aborted) onChange({ status: "unavailable", code: "CONNECTION_ERROR", message: "行情获取失败，请稍后刷新。" });
    } finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }, [onChange]);
  useEffect(() => { void refresh(); return () => active.current?.abort(); }, [refresh]);
  const quote = value?.status === "ok" ? value.quote : null;
  const signed = (value: number | null, unit = "") => value === null ? "未返回" : `${value > 0 ? "+" : ""}${fmt(value)}${unit}`;
  return <section id="market-quote" tabIndex={-1} className="market-panel" aria-label="宁德时代行情快照">
    <div className="market-heading"><span><Activity size={17} /><strong>行情快照</strong><span className="market-provider">{marketSource}</span></span>
      <button disabled={busy} onClick={() => void refresh()} aria-label="刷新宁德时代行情"><RefreshCw size={14} className={busy ? "spin" : ""} />{busy ? "获取中" : "刷新"}</button></div>
    {quote ? <>
      <div className="market-values"><div className="market-primary"><span>最新成交价</span><strong>{fmt(quote.lastPrice)}<small>元</small></strong>
        <div className={quote.change === null ? "" : quote.change > 0 ? "market-up" : quote.change < 0 ? "market-down" : ""}>{signed(quote.change, " 元")}<b>{signed(quote.changePct, "%")}</b><small>较前收</small></div></div>
        <dl>{[["今开", quote.open], ["最高", quote.high], ["最低", quote.low], ["前收", quote.previousClose]].map(([label, number]) => <div key={String(label)}><dt>{label}</dt><dd>{number === null ? "未返回" : fmt(Number(number))}<small>元</small></dd></div>)}
          <div><dt>成交量</dt><dd>{quote.volume === null ? "未返回" : fmt(quote.volume / 10000)}<small>万股</small></dd></div>
          <div><dt>成交额</dt><dd>{quote.turnover === null ? "未返回" : fmt(quote.turnover / 100000000)}<small>亿元</small></dd></div></dl></div>
      <div className="market-timing">行情时点：{quoteTime(quote.sourceTimestamp)} · 北京时间<span>获取：{quoteTime(quote.fetchedAt)}{value?.status === "ok" && value.cached ? " · 短时缓存" : ""}</span></div>
      <p className="market-notice">{quoteNotice(quote)}</p>
      <details className="market-trace"><summary>查看来源与原始字段</summary><p>标的 {quote.symbol} · 币种 {quote.currency} · 来源 <a href={marketDocs} target="_blank" rel="noreferrer">扶摇 A 股行情快照接口 ↗</a></p>
        <p>last_price = {quote.lastPrice}；price_change = {quote.change ?? "null"}；price_change_ratio_pct = {quote.changePct ?? "null"}；volume = {quote.volume ?? "null"} 股；turnover = {quote.turnover ?? "null"} 元。</p>
        <p>上游 timestamp = {quote.sourceTimestamp ?? "null"}；request_id = {quote.requestId ?? "未返回"}。涨跌幅直接使用接口百分比值，成交量与成交额仅做单位换算。</p></details>
    </> : <div className="market-empty" role="status"><span>{busy ? "正在获取宁德时代行情…" : value?.status === "unavailable" ? value.message : "等待获取行情。"}</span><span>取得数据后显示成交价、涨跌幅和行情时点。</span></div>}
  </section>;
}
