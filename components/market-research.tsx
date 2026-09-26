"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, ChartNoAxesCombined, LoaderCircle, Newspaper, RefreshCw } from "lucide-react";
import { dateLabel, historyDocs, valuationDocs, type MarketAnalysis } from "@/lib/market-analysis";
import { quoteTime } from "@/lib/market";
import type { NewsResult } from "@/lib/news";

export function MarketResearch({ onAsk }: { onAsk: (question: string) => void }) {
  const [data, setData] = useState<MarketAnalysis | null>(null);
  const [news, setNews] = useState<NewsResult | null>(null);
  const [loading, setLoading] = useState(true), [newsLoading, setNewsLoading] = useState(true);
  const [error, setError] = useState("");
  async function load(signal?: AbortSignal) {
    setLoading(true); setError("");
    try { const r = await fetch("/api/market-analysis", { signal }); if (!r.ok) throw Error(); const v = await r.json() as MarketAnalysis; if (!v.history?.status || !v.valuation?.status) throw Error(); setData(v); }
    catch { if (!signal?.aborted) setError("行情研究数据未取得，请重试。已有数据若保留，请注意其时点。"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  async function loadNews(signal?: AbortSignal) {
    setNewsLoading(true);
    try { const r = await fetch("/api/news", { signal }); if (!r.ok) throw Error(); const v = await r.json() as NewsResult; if (!v.status) throw Error(); setNews(v); }
    catch { if (!signal?.aborted) setNews({status:"unavailable",code:"CONNECTION_ERROR",message:"新闻连接失败，不能据此判断没有新事件。"}); }
    finally { if (!signal?.aborted) setNewsLoading(false); }
  }
  useEffect(() => { const c = new AbortController(); void load(c.signal); void loadNews(c.signal); return () => c.abort(); }, []);
  const h = data?.history, v = data?.valuation;
  const bars = h?.status === "ok" ? h.bars : [];
  const min = Math.min(...bars.map(b => b.close)), max = Math.max(...bars.map(b => b.close));
  const points = bars.map((b,i) => `${10+i/Math.max(1,bars.length-1)*600},${20+(max-b.close)/Math.max(1,max-min)*110}`).join(" ");
  return <section className="market-research" aria-label="行情、估值与新闻研究">
    <div className="market-research-title"><span><ChartNoAxesCombined size={18}/>把价格放回研究语境</span>
      <button disabled={loading} onClick={() => void load()}>{loading ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}刷新数据</button></div>
    {error && <p role="alert" className="market-notice">{error}</p>}
    <div className="research-grid">
      <article className="research-card">
        <div className="research-card-head"><h3>区间走势</h3><span>H01 · 前复权日线</span></div>
        {h?.status === "ok" ? <>
          <p className="research-meta">{dateLabel(h.start)} — {dateLabel(h.end)} · {h.count} 个有效交易日</p>
          <svg viewBox="0 0 620 156" role="img" aria-label={`前复权收盘价折线，区间涨跌幅 ${h.changePct.toFixed(2)}%，收盘价最大回撤 ${h.maxDrawdownPct.toFixed(2)}%`}>
            <line x1="10" y1="130" x2="610" y2="130" stroke="#e4e9f6"/><polyline points={points} fill="none" stroke="#6370d4" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>
            <text x="10" y="153" fill="#8994ab" fontSize="12">{dateLabel(h.start)}</text><text x="610" y="153" textAnchor="end" fill="#8994ab" fontSize="12">{dateLabel(h.end)}</text>
          </svg>
          <div className="research-metrics"><div><span>区间涨跌幅</span><strong>{h.changePct.toFixed(2)}%</strong></div><div><span>收盘价最大回撤</span><strong>{h.maxDrawdownPct.toFixed(2)}%</strong></div></div>
          <p className="research-note">仅描述历史，不预测后市。按已返回的首末日计算；最大回撤基于每日收盘价，未覆盖盘中波动。</p>
          <details className="research-trace"><summary>查看计算口径与日线</summary><p>涨跌幅 =（末日收盘 ÷ 首日收盘 − 1）× 100%；最大回撤 = 各日收盘相对此前最高收盘跌幅的最小值。查询近 90 个自然日，最多展示最近 60 根有效日线；未补齐缺失交易日。</p>
            <p>获取 {quoteTime(h.fetchedAt)} · <a href={historyDocs} target="_blank" rel="noreferrer">扶摇数据契约 ↗</a> · request_id: {h.requestId || "未返回"}</p>
            <div className="research-table-scroll"><table><thead><tr><th>交易日（北京时间）</th><th>前复权收盘价 / 元</th></tr></thead><tbody>{bars.map(b => <tr key={b.date}><td>{dateLabel(b.date)}</td><td>{b.close}</td></tr>)}</tbody></table></div>
          </details>
          <button className="research-ask" onClick={() => onAsk("解释最近这段区间走势和最大回撤，并说明不能据此推断什么。")}>让证研解释这段走势 <ArrowUpRight size={14}/></button>
        </> : <p className="research-note">{h?.message || "正在获取实际日线…"}</p>}
      </article>
      <article className="research-card">
        <div className="research-card-head"><h3>估值拆解</h3><span>V01 · 供应商口径</span></div>
        {v?.status === "ok" ? <>
          <p className="research-meta">接口时点 {quoteTime(v.sourceTimestamp)} · 北京时间</p>
          <dl className="valuation-grid">{([['pe_ttm','市盈率 TTM'],['pe_mrq','市盈率 MRQ'],['pb_mrq','市净率 MRQ'],['ps_ttm','市销率 TTM'],['pcf_ttm','市现率 TTM']] as const).map(([key,label]) => <div key={key}><dt>{label}</dt><dd>{v[key] === null ? "未返回" : v[key].toFixed(2) + " 倍"}</dd></div>)}</dl>
          <p className="research-note">TTM 为滚动口径，MRQ 为最近财报口径。倍数不是“便宜/贵”的结论；还需同行可比性、历史分位与盈利持续性。负值不能解释为便宜。</p>
          <details className="research-trace"><summary>查看原始倍数与时间口径</summary><p>{JSON.stringify({pe_ttm:v.pe_ttm,pe_mrq:v.pe_mrq,pb_mrq:v.pb_mrq,ps_ttm:v.ps_ttm,pcf_ttm:v.pcf_ttm})}</p><p>timestamp: {v.sourceTimestamp ?? "未返回"}；获取 {quoteTime(v.fetchedAt)}；request_id: {v.requestId || "未返回"}。估值时点与报价时点独立，不假定完全一致。</p><a href={valuationDocs} target="_blank" rel="noreferrer">扶摇估值数据契约 ↗</a></details>
          <button className="research-ask" onClick={() => onAsk("这些估值倍数该怎么理解？判断宁德时代贵不贵还缺什么证据？")}>理解倍数与判断边界 <ArrowUpRight size={14}/></button>
        </> : <p className="research-note">{v?.message || "正在获取实际估值…"}</p>}
      </article>
    </div>
    <article className="research-card news-research">
      <div className="research-card-head"><h3><Newspaper size={17}/>近期新闻与事件</h3><button disabled={newsLoading} onClick={() => void loadNews()}>{newsLoading ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}查询 iFinD</button></div>
      {newsLoading && <p className="research-note" role="status">正在检索宁德时代近七天公开资讯…</p>}
      {!newsLoading && news?.status === "unavailable" && <p className="research-note" role="status">{news.message}</p>}
      {news?.status === "ok" && <>
        <p className="research-meta">iFinD · 检索范围 {news.from} — {news.to} · 获取 {quoteTime(news.fetchedAt)}（北京时间）</p>
        <p className="research-note">新闻检索结果用于发现线索。媒体报道、观点与公司公告的证据强度不同，尚未逐条核实原文；不将报道与股价变化直接判为因果。</p>
        <div className="news-articles">{news.articles.map(article => <details className="research-trace" key={article.id}><summary><span className="news-id">{article.id}</span>{article.title}<small>{article.publishedAt} · {article.source} · 媒体报道</small></summary><p>{article.excerpt}</p>{article.warnings.map(w => <p className="news-warning" key={w}>{w}</p>)}{article.url && <a href={article.url} target="_blank" rel="noreferrer">核对原文 ↗</a>}</details>)}</div>
        <button className="research-ask" onClick={() => onAsk("结合刚检索到的宁德时代新闻，分别说明报道内容、可能影响和还需要验证的证据。不要给交易建议。")}>分析新闻影响与待验证问题 <ArrowUpRight size={14}/></button>
      </>}
    </article>
  </section>;
}
