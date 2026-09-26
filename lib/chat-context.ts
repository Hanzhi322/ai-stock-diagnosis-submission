import { dateLabel, historyDocs, valuationDocs, type HistoryResult, type ValuationResult } from "./market-analysis";
import { quoteTime } from "./market";
import type { NewsResult } from "./news";
import type { ChatFact } from "./stock-chat";
export type ChatContext = { history?: HistoryResult; valuation?: ValuationResult; news?: NewsResult };
export type ChatSource = { id: string; title: string; url: string; text: string; timing?: string };
export const companySource: ChatSource = {
  id: "C01", title: "公司业务简介 · 宁德时代官网", url: "https://www.catl.com/",
  text: "宁德时代新能源科技股份有限公司（CATL），研究对象为深交所 A 股 300750.SZ。公司主要从事动力电池与储能电池相关业务。动力电池为电动汽车等提供动力；储能系统用于电力系统等场景。公司官网介绍其电动出行与储能解决方案。业务介绍不能推导股票是否值得购买。",
  timing: "业务简介核对：2026-09-26；不代表实时经营结论",
};
export function contextSources(context: ChatContext): ChatSource[] {
  const sources = [companySource];
  if (context.history?.status === "ok") sources.push({ id: "H01", title: "前复权历史行情与区间计算", url: historyDocs,
    text: "扶摇日线，前复权。区间涨跌幅＝末日收盘价÷首日收盘价−1；最大回撤基于区间内每日收盘价相对此前最高收盘价计算。区间从已有首根到末根，不含区间首日前一交易日；均为历史描述，不预测后市。",
    timing: `${dateLabel(context.history.start)} 至 ${dateLabel(context.history.end)}，${context.history.count} 根日线` });
  if (context.valuation?.status === "ok") sources.push({ id: "V01", title: "估值快照 · 同花顺扶摇", url: valuationDocs,
    text: "PE TTM 为滚动口径，PE MRQ 为最近财报口径；PB MRQ、PS TTM、PCF TTM 按供应商口径原样展示。负值不能解释为便宜。缺少同行与历史分位，不能单凭市盈率断言高估或低估；估值和行情时间分别展示，不假定同一时点。",
    timing: quoteTime(context.valuation.sourceTimestamp) });
  if (context.news?.status === "ok") for (const a of context.news.articles) sources.push({ id: a.id, title: a.title, url: a.url || "https://mcp.51ifind.com/",
    text: "核验提示：" + a.warnings.join(" ") + "\n新闻片段：" + a.excerpt, timing: `报道发表 ${a.publishedAt}；来源 ${a.source}；获取 ${quoteTime(context.news.fetchedAt)}（北京时间）` });
  return sources;
}
export function contextFacts(context: ChatContext): Record<string, ChatFact> {
  const facts: Record<string, ChatFact> = {
    "company.ticker": { key: "company.ticker", label: "A 股代码", value: "300750.SZ", page: 0, period: "公司标识", sourceUrl: companySource.url },
  };
  const add = (key: string, label: string, value: string, period: string, sourceUrl: string) => { facts[key] = { key, label, value, period, sourceUrl, page: 0 }; };
  const h = context.history;
  if (h?.status === "ok") {
    const period = `${dateLabel(h.start)} 至 ${dateLabel(h.end)}，前复权`;
    add("history.period", "行情区间", period, period, historyDocs);
    add("history.count", "有效交易日线", `${h.count} 根`, period, historyDocs);
    add("history.changePct", "区间涨跌幅", `${h.changePct.toFixed(2)} %`, period, historyDocs);
    add("history.maxDrawdownPct", "收盘价最大回撤", `${h.maxDrawdownPct.toFixed(2)} %`, period, historyDocs);
    add("history.firstClose", "区间首日收盘价", `${h.bars[0].close.toFixed(2)} 元`, period, historyDocs);
    add("history.lastClose", "区间末日收盘价", `${h.bars.at(-1)!.close.toFixed(2)} 元`, period, historyDocs);
  }
  const v = context.valuation;
  if (v?.status === "ok") {
    for (const [key, label] of [["pe_ttm","市盈率 TTM"],["pe_mrq","市盈率 MRQ"],["pb_mrq","市净率 MRQ"],["ps_ttm","市销率 TTM"],["pcf_ttm","市现率 TTM"]] as const) {
      if (v[key] !== null) add(`valuation.${key}`, label, `${v[key].toFixed(2)} 倍`, quoteTime(v.sourceTimestamp), valuationDocs);
    }
    if (v.sourceTimestamp !== null) add("valuation.asOf", "估值接口时点", quoteTime(v.sourceTimestamp), "北京时间", valuationDocs);
  }
  if (context.news?.status === "ok") for (const a of context.news.articles) {
    const source = a.url || "https://mcp.51ifind.com/";
    add(`news.${a.id}.date`, `${a.id} 报道发表日期`, a.publishedAt, "新闻日期，非事件发生日期", source);
    // Quotes remain attributed to their news item, never promoted to verified
    // financial fields. Conflicting excerpts supply no numerical facts.
    if (a.warnings.some(w => w.includes("不同的动力电池收入"))) continue;
    const seen = new Set<string>(); let count = 0;
    for (const match of a.excerpt.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(亿元|万元|亿|个百分点|%|％|GWh|Ah|元\/Wh)/g)) {
      const value = `${match[1]} ${match[2] === "亿" ? "亿元" : match[2] === "％" ? "%" : match[2]}`;
      if (seen.has(value)) continue; seen.add(value);
      add(`news.${a.id}.n${++count}`, `${a.id} 报道转述：${a.excerpt.slice(Math.max(0,match.index!-16),match.index!+match[0].length+10)}`, value, `报道 ${a.publishedAt}；待核对原文口径`, source);
      if (count >= 12) break;
    }
  }
  return facts;
}
export function neededResearch(question: string) {
  const coverage = /还缺|缺哪些|哪些关键信息|数据缺口/.test(question);
  return { company: /介绍|是什么公司|什么企业|做什么|干什么|主营|宁德时代是什么/.test(question),
    history: coverage || /走势|历史行情|回撤|过去|近.{0,6}(?:月|周|天)|区间/.test(question),
    valuation: coverage || /估值|市盈|市净|市销|市现|便宜|贵不贵|贵吗|高估|低估|PE\b|PB\b/i.test(question),
    news: coverage || /新闻|资讯|公告|事件|政策|传闻|利好|利空|发生了什么|新消息/.test(question) };
}
