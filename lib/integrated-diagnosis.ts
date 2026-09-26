import { diagnose, evidence, fmt, metrics, snapshot, typeLabels, type Diagnosis, type DiagnosisDataStatus, type Evidence, type EvidenceSource } from "./research";
import { marketDocs, quoteNotice, quoteTime, quoteFreshness, type MarketResult } from "./market";
import { dateLabel, historyDocs, valuationDocs, type HistoryResult, type ValuationResult } from "./market-analysis";
import { ifindGuide, type NewsResult } from "./news";

export const overviewQuestion = "结合财报、最新查询的股价、估值、近期走势与新闻，综合诊断宁德时代，有哪些矛盾和待验证事项？";
export type DiagnosisContext = { market: MarketResult; history: HistoryResult; valuation: ValuationResult; news: NewsResult };
const source = (label:string,url:string,timing:string,requestId?:string|null):EvidenceSource => ({label,url,timing,requestId});
const newsConflict = (warnings:string[]) => warnings.some(w=>w.includes("不同的动力电池收入"));
const baseCard = (id:string,dimension:string,now:number):Evidence => ({id,dimension,type:"neutral",label:typeLabels.neutral,title:"",fact:"",inference:"",boundary:"",fieldIds:[],page:0,nextQuestion:"结合这些证据，还需要验证什么？",collectedAt:now});
const timing = (fetchedAt:number,stamp:number|null) => `接口数据就绪时点 ${quoteTime(stamp)}；抓取 ${quoteTime(fetchedAt)}（北京时间）`;

/** All numbers come from provider fields or deterministic calculations, never from an LLM. */
export function integratedDiagnosis(question:string,context:DiagnosisContext,now=Date.now()):Diagnosis {
 const base=diagnose(question);
 if(base.blocked)return {...base,generatedAt:new Date(now).toISOString()};
 const {market,history,valuation,news}=context;
 const catalog:Evidence[]=evidence.map(e=>({...e}));
 const states:DiagnosisDataStatus[]=[{id:"financial",label:"财报",status:"ok",timing:snapshot.reportPeriod,detail:`披露 ${snapshot.publishedAt} · 半年报快照，非当前财务数据`}];
 const complete:string[]=[],missing:string[]=[];
 if(market.status==="ok"){
  const q=market.quote;
  complete.push("价格快照");
  states.push({id:"market",label:"价格快照",status:quoteFreshness(q,now)!=="recent"?"partial":"ok",timing:quoteTime(q.sourceTimestamp),detail:`${quoteNotice(q)} 数据就绪时点不等于成交时间。`});
  catalog.push({...baseCard("M01","价格快照",q.fetchedAt),title:"当前查询到的市场定价",fact:`接口最新价 ${fmt(q.lastPrice)} 元/股；涨跌幅 ${q.changePct===null?"未获得":fmt(q.changePct)+"%"}。${quoteNotice(q)}`,inference:"价格为本次研究补充市场定价背景；单日涨跌不能证明经营改善或恶化。",boundary:"上游时间是数据就绪时点，未提供最近成交时间。该价格不能直接与不同时点的财报盈利计算估值。",rawFields:[{label:"last_price / 最新价",value:q.lastPrice,unit:"元/股",period:"接口快照"},{label:"change_pct / 涨跌幅",value:q.changePct,unit:"%",period:"接口快照"},{label:"previous_close / 昨收",value:q.previousClose,unit:"元/股",period:"接口快照"}],sources:[source("同花顺 · 扶摇价格快照",marketDocs,timing(q.fetchedAt,q.sourceTimestamp),q.requestId)],nextQuestion:"当前价格、估值与财报盈利能否直接比较？"});
 }else{missing.push(`价格快照：${market.message}`);states.push({id:"market",label:"价格快照",status:"unavailable",timing:"未取得",detail:market.message});}
 if(history.status==="ok"){
  const period=`${dateLabel(history.start)} 至 ${dateLabel(history.end)}`;
  complete.push("前复权日线");
  states.push({id:"history",label:"历史走势",status:"ok",timing:period,detail:`${history.count} 根前复权日线 · 不是当日实时走势`});
  catalog.push({...baseCard("H01","历史走势",history.fetchedAt),title:"近期价格表现与回撤",fact:`${period}，${history.count} 根前复权日线的首尾涨跌幅为 ${fmt(history.changePct)}%，区间最大收盘回撤为 ${fmt(history.maxDrawdownPct)}%。`,inference:history.changePct<0?"所查区间价格走弱，可与财报增长交叉观察；不能由价格下跌反推具体经营原因。":"所查区间价格表现可补充市场视角；不能由历史涨幅推断未来趋势。",boundary:"首尾涨跌幅基于区间首日和末日收盘，不是从首日前一日开始的收益率。回撤仅用日收盘价，不含盘中极值。与财报期间不同，不能直接建立因果关系。",formula:"首尾涨跌幅 =（末日收盘 ÷ 首日收盘 − 1）× 100%；最大收盘回撤 = min（当日收盘 ÷ 截至当日最高收盘 − 1）× 100%",rawFields:[{label:"首尾涨跌幅",value:history.changePct,unit:"%",period},{label:"最大收盘回撤",value:history.maxDrawdownPct,unit:"%",period},...history.bars.map(bar=>({label:"close_price / 前复权收盘",value:bar.close,unit:"元/股",period:dateLabel(bar.date)}))],sources:[source("同花顺 · 扶摇前复权日线",historyDocs,timing(history.fetchedAt,history.sourceTimestamp),history.requestId)],nextQuestion:"利润增长与近期价格走弱之间，有哪些不能直接下结论的地方？"});
 }else{missing.push(`历史走势：${history.message}`);states.push({id:"history",label:"历史走势",status:"unavailable",timing:"未取得",detail:history.message});}
 if(valuation.status==="ok"){
  const keys=["pe_ttm","pe_mrq","pb_mrq","ps_ttm","pcf_ttm"] as const;
  const labels=["市盈率 TTM","市盈率 MRQ","市净率 MRQ","市销率 TTM","市现率 TTM"];
  const absent=keys.filter(k=>valuation[k]===null);
  complete.push("估值快照");
  if(absent.length)missing.push(`估值字段未获得：${absent.join("、")}`);
  states.push({id:"valuation",label:"估值",status:absent.length||valuation.sourceTimestamp===null?"partial":"ok",timing:quoteTime(valuation.sourceTimestamp),detail:`${keys.length-absent.length} 项有效指标 · 同行与历史分位未接入`});
  catalog.push({...baseCard("V01","估值口径",valuation.fetchedAt),title:"估值指标已取得，高低仍需可比基准",fact:keys.map((k,i)=>`${labels[i]} ${valuation[k]===null?"未获得":fmt(valuation[k])+" 倍"}`).join("；")+"。",inference:"已能观察接口估值倍数；没有同行同口径比较和自身历史分位，不能直接判断便宜或贵。",boundary:"TTM 与 MRQ 使用不同盈利或财务口径。指标直接来自上游，底层盈利、总股本和具体估值交易日未独立重算；数据就绪时间不等于估值对应交易日。负值不代表低估，空值不补零。",rawFields:keys.map((k,i)=>({label:`${k} / ${labels[i]}`,value:valuation[k],unit:"倍",period:"上游估值快照；具体交易日未返回"})),sources:[source("同花顺 · 扶摇估值快照",valuationDocs,timing(valuation.fetchedAt,valuation.sourceTimestamp),valuation.requestId)],nextQuestion:"这些估值指标能否说明便宜，还缺什么比较证据？"});
 }else{missing.push(`估值：${valuation.message}`);states.push({id:"valuation",label:"估值",status:"unavailable",timing:"未取得",detail:valuation.message});}
 if(news.status==="ok"&&news.articles.length){
  complete.push("近期新闻检索");
  const warnings=news.articles.some(n=>newsConflict(n.warnings));
  states.push({id:"news",label:"新闻与事件",status:"partial",timing:`${news.from} 至 ${news.to}`,detail:`${news.articles.length} 条媒体片段 · ${warnings?"含待核验冲突 · ":""}未核对完整原文，事件不保证完整覆盖`});
  for(const n of news.articles){catalog.push({...baseCard(n.id,"新闻与事件",news.fetchedAt),type:newsConflict(n.warnings)?"conflict":"neutral",label:newsConflict(n.warnings)?typeLabels.conflict:"媒体线索",title:n.title,fact:`${n.source} 于 ${n.publishedAt} 发布的媒体片段：${n.excerpt}`,inference:newsConflict(n.warnings)?"这条媒体片段存在待核验问题，相关争议数字不得用于诊断推论。":"该信息可补充财报披露后的研究线索，但媒体报道不等同于公司公告或事件已经兑现。",boundary:[...n.warnings,"仅取得新闻检索片段，尚未独立核验完整原文。发布时间不一定是事件发生时间；不能将报道与股价变化直接建立因果。"].join(" "),rawFields:[{label:"新闻发布时间",value:n.publishedAt,unit:"北京时间",period:"发布时间，非事件发生时间"},{label:"检索范围",value:`${news.from} 至 ${news.to}`,unit:"北京时间",period:"查询窗口"}],sources:[source(n.url?n.source:"iFinD 新闻检索（原文链接缺失）",n.url||ifindGuide,`发布 ${n.publishedAt}；抓取 ${quoteTime(news.fetchedAt)}（北京时间）`)],nextQuestion:`“${n.title.slice(0,70)}”需要哪些原始公告来验证？`});}
 }else{const message=news.status==="unavailable"?news.message:"该检索窗口未返回新闻，不能推断没有事件。";missing.push(`新闻：${message}`);states.push({id:"news",label:"新闻与事件",status:"unavailable",timing:"未取得可用片段",detail:message});}
 if(history.status==="ok"){
  const divergent=history.changePct<0&&(metrics().profitGrowth??0)>0;
  catalog.push({...baseCard("X01","跨来源验证",now),type:divergent?"conflict":"neutral",label:divergent?typeLabels.conflict:typeLabels.neutral,title:divergent?"财报利润增长，近期价格却走弱":"经营增长与市场表现需分期对照",fact:`半年报归母净利润同比增长 ${fmt(metrics().profitGrowth)}%；${dateLabel(history.start)} 至 ${dateLabel(history.end)} 前复权收盘首尾涨跌幅 ${fmt(history.changePct)}%。`,inference:divergent?"经营增长没有对应为所查区间的价格上涨，说明不能从利润增长直接推出市场表现；具体原因仍待研究。":"经营表现与价格序列提供不同视角；同向或反向变化都不自动建立因果。",boundary:"财务同比和价格区间不是同一期间；未控制行业指数、市场整体变化、预期和事件影响。不用新闻发布时间直接解释价格变化。",fieldIds:["profit"],relatedIds:["E02","H01",...(valuation.status==="ok"?["V01"]:[]),...catalog.filter(e=>e.id.startsWith("N")).slice(0,1).map(e=>e.id)],sources:[source(snapshot.provider,snapshot.source+"#page=8",`报告期 ${snapshot.reportPeriod}；披露 ${snapshot.publishedAt}`),...catalog.find(e=>e.id==="H01")!.sources!],rawFields:[{label:"归母净利润同比",value:metrics().profitGrowth,unit:"%",period:"2026 H1 对比 2025 H1"},{label:"收盘首尾涨跌幅",value:history.changePct,unit:"%",period:`${dateLabel(history.start)} 至 ${dateLabel(history.end)}`}],nextQuestion:"经营增长、近期行情与新闻线索之间，哪些是事实，哪些只是推测？"});
 }
 catalog[catalog.findIndex(e=>e.id==="E04")]={...baseCard("E04","证据缺口",now),type:"unknown",label:typeLabels.unknown,title:missing.length?"部分资料未取得，保留诊断缺口":"已补充市场与新闻，仍需验证估值基准与事件",fact:`本次已取得：${complete.length?complete.join("、"):"财报快照以外的数据均未取得"}。${missing.length?"未取得或不完整："+missing.join("；")+"。":""}`,inference:"以实际可用资料确定诊断范围；同行同口径估值、自身历史估值分位、事件原始公告核验仍待补充。",boundary:"数据不可用时不生成正常结论；价格快照不是逐笔行情，媒体片段不是公告事实。不能据此给出完整估值或涨跌预测。",rawFields:states.map(s=>({label:s.label,value:s.status==="ok"?"已取得":s.status==="partial"?"部分取得 / 待核验":"未取得",unit:s.detail,period:s.timing})),nextQuestion:"结合已取得的数据，当前诊断还缺哪些关键证据？"};
 const newsIds=catalog.filter(e=>e.id.startsWith("N")).map(e=>e.id);
 const newsConflictIds=catalog.filter(e=>e.id.startsWith("N")&&e.type==="conflict").map(e=>e.id);
 const marketIds=["M01","H01","V01"].filter(id=>catalog.some(e=>e.id===id));
 const broad=/综合|整体|最新|概览|新闻|事件|风险|反证/.test(question);
 const comprehensive=/综合|整体|概览/.test(question);
 const leading=comprehensive?["X01","E01","E02","E03"]:/股价|估值|走势|行情|便宜|市盈率/.test(question)?marketIds:/新闻|事件/.test(question)?newsIds.slice(0,2):base.ids;
 const ids=Array.from(new Set([...leading,...base.ids,...(broad?["X01",...marketIds,...newsIds.slice(0,2),...newsConflictIds]:[]),"E04"])).filter(id=>catalog.some(e=>e.id===id));
 const marketSummary=history.status==="ok"?(history.changePct<0?"所查历史区间价格走弱，与财报利润增长形成不同方向的信号；两者期间不同，原因尚未验证。":"历史走势已补充，但不能从过往价格表现推断未来趋势。"):"历史走势未取得，暂不作价格趋势判断。";
 const newsSummary=newsIds.length?`已加入近期媒体线索${newsConflictIds.length?"，其中存在待核验冲突":""}，事件是否兑现仍需核对原始公告。`:"新闻检索没有取得可用证据，不能据此认定近期无重大事件。";
 return {...base,focus:broad?"经营、市场与事件的交叉诊断":base.focus,reason:"结合电池制造业的盈利与现金回流、市场定价和新闻线索；每类资料独立标注期间，避免将不同来源和时点拼成确定因果。",summary:`财报显示经营规模与利润增长，但现金流增速和主营毛利率需要保留反证。${marketSummary}${newsSummary}`,notice:"规则整理：已查询多来源证据，尚未调用大模型。点击「开始诊断」生成 AI 综合解读。",ids,catalog,dataStatus:states,generatedAt:new Date(now).toISOString(),followups:["利润增长与近期走势为什么不能直接作因果解释？","当前估值判断还缺什么比较证据？","近期新闻有哪些冲突，需要怎样核验？"]};
}
