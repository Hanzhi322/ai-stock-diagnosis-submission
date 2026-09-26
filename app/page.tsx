"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ArrowRight, ScanLine, FileCheck2, Sparkles, ChevronRight, ShieldCheck, Download, Activity, LoaderCircle, AlertTriangle, Check, Search, Database, Clock3, Braces, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { SidebarProvider, Sidebar, SidebarContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { snapshot, fields, evidence, typeLabels, metrics, fmt, amount, growth, exportResearch, evidenceReviewKey, staleDays, type Evidence, type Diagnosis } from "@/lib/research";
import { StockChat } from "@/components/stock-chat";
import { MarketResearch } from "@/components/market-research";
import { MarketQuotePanel } from "@/components/market-quote";
import type { MarketResult } from "@/lib/market";

import { DiagnosisContext, EvidenceTrace } from "@/components/diagnosis-context";
import { overviewQuestion } from "@/lib/integrated-diagnosis";

const m=metrics();
const presets=[{label:"增长质量",q:"利润增长是否有现金流支撑？"},{label:"业务结构",q:"储能业务的毛利率有什么变化？"},{label:"风险与反证",q:"有哪些需要继续验证的风险？"}];
const initialIds=["E01","E02","E03","E04"];
function download(text:string,name:string,type="text/markdown;charset=utf-8"){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export default function Home(){
 const [selected,setSelected]=useState<Evidence|null>(null);
 const [question,setQuestion]=useState("");
 const [tab,setTab]=useState("diagnosis");
 const [navigationRequest,setNavigationRequest]=useState({sequence:0,target:"tabs" as "tabs"|"diagnosis"});
 const researchTabsRef=useRef<HTMLDivElement>(null);
 const diagnosisResultsRef=useRef<HTMLElement>(null);
 const navigateToTab=useCallback((nextTab:string)=>{setTab(nextTab);setNavigationRequest(n=>({sequence:n.sequence+1,target:"tabs"}));},[]);
 useEffect(()=>{
  if(!navigationRequest.sequence)return;
  // Wait for the selected panel to mount, including repeat clicks on the same section.
  const frame=requestAnimationFrame(()=>{
   const target=navigationRequest.target==="diagnosis"?diagnosisResultsRef.current:researchTabsRef.current;if(!target)return;
   if(navigationRequest.target==="diagnosis")target.focus({preventScroll:true});
   else target.querySelector<HTMLButtonElement>('[role="tab"][data-state="active"]')?.focus({preventScroll:true});
   target.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
  });
  return()=>cancelAnimationFrame(frame);
 },[navigationRequest]);
 const [result,setResult]=useState<Diagnosis|null>(null);
 const [overview,setOverview]=useState<Diagnosis|null>(null);
 const [sourcesLoading,setSourcesLoading]=useState(false);
 const [sourcesError,setSourcesError]=useState("");
 const catalog=result?.catalog??overview?.catalog??evidence;
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [diagnosisError,setDiagnosisError]=useState("");
 const [filter,setFilter]=useState("all");
 const [search,setSearch]=useState("");
 const [status,setStatus]=useState<{modelConfigured:boolean;model:string|null;chatPreview?:boolean}|null>(null);
 const [statusError,setStatusError]=useState(false);
 const [reviewed,setReviewed]=useState<string[]>([]);
 const [copied,setCopied]=useState(false);
 const [market,setMarket]=useState<MarketResult|null>(null);
 const [researchQuestion,setResearchQuestion]=useState<{id:number;question:string}|null>(null);
 const [history,setHistory]=useState<Diagnosis[]>([]);
 const inputRef=useRef<HTMLInputElement>(null);
 const requestId=useRef(0);
 const activeRequest=useRef<AbortController|null>(null);
 const selectedRef=useRef<Evidence|null>(null);
 const [age,setAge]=useState<number|null>(null);
 useEffect(()=>{setAge(staleDays());fetch("/api/status").then(r=>{if(!r.ok)throw Error();return r.json()}).then(v=>setStatus(v as {modelConfigured:boolean;model:string|null})).catch(()=>setStatusError(true));try{const v=JSON.parse(localStorage.getItem("zhengyan-reviewed-v1")||"[]");if(Array.isArray(v))setReviewed(v.filter((x:unknown)=>typeof x==="string"&&/^(?:[EMHVNX]\d{2})(?:@\d{10,16})?$/.test(x)));}catch{}return()=>activeRequest.current?.abort();},[]);
 const openEvidence=useCallback((id:string)=>{const e=catalog.find(e=>e.id===id);if(!e)throw new Error("未知证据编号");selectedRef.current=e;setSelected(e);return {id:e.id,title:e.title,fieldIds:e.fieldIds};},[catalog]);
 const runDiagnosis=useCallback(async(q:string)=>{
  if(!q.trim()||q.length>500){setError("请输入 1—500 字的研究问题。");inputRef.current?.focus();throw new Error("问题为空或过长");}
  const id=++requestId.current;activeRequest.current?.abort();const controller=new AbortController();activeRequest.current=controller;
  setQuestion(q);setBusy(true);setError("");setDiagnosisError("");setTab("diagnosis");setSelected(null);
  setNavigationRequest(n=>({sequence:n.sequence+1,target:"diagnosis"}));
  try{const res=await fetch("/api/diagnose",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q}),signal:controller.signal});const data=await res.json() as Diagnosis & {error?:string};if(!res.ok)throw new Error(data.error||"诊断接口暂不可用。");if(!Array.isArray(data.ids)||!data.ids.every((x:string)=>(data.catalog??evidence).some(e=>e.id===x)))throw new Error("返回结果未通过证据校验。");if(id!==requestId.current)return null;setResult(data);setHistory(prev=>[data,...prev.filter(x=>x.question!==q)].slice(0,5));return data as Diagnosis;}
  catch(err){if(id===requestId.current&&!(err instanceof Error&&err.name==="AbortError")){const message="诊断未完成。请重试；下方保留上一次结果或初始证据概览。";setError(message);setDiagnosisError(message);}throw err;}
  finally{if(id===requestId.current)setBusy(false);}
 },[]);
 const refreshOverview=useCallback(async(replace=false)=>{
  setSourcesLoading(true);setSourcesError("");const startedAt=requestId.current;
  try{const response=await fetch("/api/diagnose");if(!response.ok)throw Error();const data=await response.json() as Diagnosis;
   if(!Array.isArray(data.catalog)||!Array.isArray(data.ids)||!data.ids.every(id=>data.catalog!.some(e=>e.id===id)))throw Error();
   setOverview(data);if(requestId.current===startedAt){if(replace){setResult(data);setSelected(null);}else setResult(previous=>previous??data);}
  }catch{setSourcesError("本轮资料查询失败，未更新诊断。下方若有结果，仍是上一轮资料。");}finally{setSourcesLoading(false);}
 },[]);
 useEffect(()=>{if(status?.chatPreview)void refreshOverview();},[status?.chatPreview,refreshOverview]);
 const ask=(q:string)=>{void runDiagnosis(q).catch(()=>{});};
 useEffect(()=>{
  const context=(document as unknown as {modelContext?:{registerTool:(tool:unknown,options:unknown)=>unknown}}).modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const tools=[{name:"open_research_evidence",description:"在证研工作台打开证据抽屉并返回其字段编号。",inputSchema:{type:"object",properties:{id:{type:"string",enum:catalog.map(e=>e.id)}},required:["id"],additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{const id=(input as {id?:unknown})?.id;if(typeof id!=="string")throw new Error("id 必须是字符串");const value=openEvidence(id);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return value;}},
  {name:"run_company_diagnosis",description:"基于宁德时代财报与当前可用行情、估值、新闻执行诊断并更新可见结果。不执行交易。",inputSchema:{type:"object",properties:{question:{type:"string",minLength:1,maxLength:500}},required:["question"],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async(input:unknown)=>{const q=(input as {question?:unknown})?.question;if(typeof q!=="string")throw new Error("question 必须是字符串");const r=await runDiagnosis(q);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return r?{focus:r.focus,mode:r.mode,evidenceIds:r.ids,notice:r.notice}:null;}}];
  tools.forEach(tool=>{try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}});return()=>lifecycle.abort();
 },[openEvidence,runDiagnosis,catalog]);
 const toggleReviewed=()=>{if(!selected)return;const next=reviewed.includes(evidenceReviewKey(selected))?reviewed.filter(x=>x!==evidenceReviewKey(selected)):[...reviewed,evidenceReviewKey(selected)];setReviewed(next);try{localStorage.setItem("zhengyan-reviewed-v1",JSON.stringify(next));}catch{setError("浏览器未允许保存；核验标记仅保留在本次会话。");}};
 const visibleIds=result?.ids??initialIds;
 const visible=visibleIds.flatMap(id=>catalog.find(e=>e.id===id)??[]);
 const evidenceList=catalog.filter(e=>(filter==="all"||e.type===filter)&&(!search||[e.id,e.title,e.fact,e.dimension].join(" ").toLowerCase().includes(search.toLowerCase())));
 const modeText=statusError?"模型状态未获得":status?.modelConfigured?"AI 解读已配置":status?"规则模式 · 待连接模型":"正在检查模型";
 const card=(e:Evidence)=><button className="finding" key={e.id} onClick={()=>openEvidence(e.id)}><div className="finding-header"><span className={"status-label "+e.type}>{e.label}</span><span className="finding-dimension">{e.dimension}</span>{reviewed.includes(evidenceReviewKey(e))&&<span className="reviewed-label"><Check size={12}/>已核验</span>}</div><h3>{e.title}</h3><p>{e.id.startsWith("N")&&e.fact.length>180?e.fact.slice(0,180)+"…":e.fact}</p>{e.id.startsWith("N")&&e.type==="conflict"&&<p className="news-warning">片段存在数字冲突，相关数值不用于诊断推论。</p>}<div className="finding-footer"><span>{e.id} · {e.sources?(e.id.startsWith("N")?"媒体线索 → 原文核验":"查询数据 → 交叉验证"):e.page?"披露事实 → 分析推断":"数据缺口 → 待验证"}</span><span>沿证据验证 <ArrowRight size={14}/></span></div></button>;
 return <div className="workspace"><header className="topbar"><a className="brand" href="/"><span className="brand-mark"><ScanLine size={23}/></span><strong>证研</strong><span className="brand-en">EVIDENCE LAB</span></a><span className="top-context">个股研究工作台 <ChevronRight size={14}/> 宁德时代</span><div className="top-right"><button className="snapshot" onClick={()=>navigateToTab("method")}>{modeText}</button><ShieldCheck size={19}/></div></header>
 <SidebarProvider className="workspace-body" style={{minHeight:"calc(100vh - 76px)"}}><Sidebar collapsible="none" className="research-rail"><SidebarContent><div className="rail-heading">研究对象</div><div className="stock-card"><span className="stock-monogram">宁</span><div><strong>宁德时代</strong><span>300750 · 深交所</span></div></div><div className="rail-divider"/><div className="rail-heading">研究路径</div><SidebarMenu>{[["diagnosis","01","多维诊断"],...(status?.chatPreview?[["market","02","行情与新闻"]]:[]),["evidence",status?.chatPreview?"03":"02","证据验证"],["method",status?.chatPreview?"04":"03","数据与方法"]].map(([id,n,label])=><SidebarMenuItem key={id}><SidebarMenuButton className={tab===id?"rail-active":"rail-item"} isActive={tab===id} onClick={()=>navigateToTab(id)}><span>{n}</span>{label}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu><div className="rail-note"><FileCheck2 size={20}/><strong>先看证据，再形成判断</strong><p>每条结论都保留来源、时点和口径。不确定的信息，也值得被看见。</p></div>{history.length>0&&<div className="history"><div className="rail-heading">本次研究</div>{history.map((h,i)=><button key={h.question} onClick={()=>{setResult(h);setQuestion(h.question);navigateToTab("diagnosis");}}><span>0{i+1}</span>{h.question}</button>)}</div>}<div className="rail-bottom">研究辅助 · 不构成投资建议</div></SidebarContent></Sidebar>
 <main className="main-area"><div className="page-heading"><div><div className="eyebrow">COMPANY RESEARCH / 001</div><h1>宁德时代 <span>300750.SZ</span></h1><p>动力电池与储能 · 制造业　/　经营、市场与事件研究</p></div><button className="secondary-button" onClick={()=>download(exportResearch(result),"证研-宁德时代-研究记录.md")}><Download size={16}/> 导出研究</button></div>
 <div className="data-notice"><Clock3 size={16}/><span>财务截至 <b>2026.06.30</b> · 公告披露 2026.07.24{age!==null?`（${age} 天前）`:""} · 财报指标口径（行情与新闻另列查询时点）</span><button onClick={()=>navigateToTab("method")}>数据口径 <ArrowUpRight size={14}/></button></div>
 {status?.chatPreview&&<MarketQuotePanel value={market} onChange={setMarket}/>}
 <section className="ask-panel"><div className="ask-icon"><Sparkles size={21}/></div><div className="ask-content"><h2>从一个好问题开始</h2><form className="ask-input" onSubmit={e=>{e.preventDefault();ask(question);}}><input ref={inputRef} aria-label="输入研究问题" value={question} maxLength={500} onChange={e=>setQuestion(e.target.value)} placeholder="例如：利润增长，是否有真实现金流支撑？"/><button className="primary-button" type="submit" disabled={busy}>{busy?<><LoaderCircle size={16} className="spin"/>诊断中</>:<>开始诊断 <ArrowRight size={16}/></>}</button></form><div className="suggestions">研究切入点 {status?.chatPreview&&<button disabled={busy} onClick={()=>ask(overviewQuestion)}>综合诊断</button>}{presets.map(p=><button key={p.label} disabled={busy} onClick={()=>ask(p.q)}>{p.label}</button>)}</div></div></section>
 {error&&<div className="error-notice" role="alert"><AlertTriangle size={17}/>{error}<button aria-label="关闭错误提示" onClick={()=>setError("")}><X size={15}/></button></div>}
 <div className="metric-grid">{[["营业收入",amount(fields[0].current),"亿元","+"+fmt(m.revenueGrowth)+"%","同比增长","E01"],["归母净利润",amount(fields[1].current),"亿元","+"+fmt(m.profitGrowth)+"%","同比增长","E02"],["经营现金流",amount(fields[3].current),"亿元","+"+fmt(m.cashGrowth)+"%","同比增长","E02"],["现金流 / 归母净利润",fmt(m.cashRatio),"倍",fmt(m.cashRatioChange)+" 倍","较上年同期","E02"]].map((v,i)=><button className="metric" key={v[0]} onClick={()=>openEvidence(v[5])}><span className="metric-label">{v[0]}<ArrowUpRight size={14}/></span><strong>{v[1]}<small>{v[2]}</small></strong><span className={i===3?"metric-change caution":"metric-change"}>{v[3]} <span>{v[4]}</span></span></button>)}</div>
 <Tabs value={tab} onValueChange={setTab}><TabsList ref={researchTabsRef} className="research-tabs" variant="line"><TabsTrigger value="diagnosis">诊断概览</TabsTrigger>{status?.chatPreview&&<TabsTrigger value="market">行情与新闻</TabsTrigger>}<TabsTrigger value="evidence">证据清单 <span className="count">{catalog.length}</span></TabsTrigger><TabsTrigger value="method">数据与方法</TabsTrigger></TabsList>
 <TabsContent value="diagnosis">{status?.chatPreview&&<DiagnosisContext result={result?.dataStatus?result:overview} loading={sourcesLoading} error={sourcesError} onRefresh={()=>void refreshOverview(true)} disabled={busy}/>}<div className="diagnosis-grid"><section ref={diagnosisResultsRef} tabIndex={-1} className="diagnosis-results" aria-label="诊断结果" aria-busy={busy}><div className="section-title"><h2>{busy?"正在生成诊断":result?.focus??"增长背后，哪些信号值得关注？"}</h2><span>{result?result.mode==="llm"?"AI 语义诊断":"规则诊断":"事实与推断分开呈现"}</span></div>{busy&&<div className="diagnosis-progress" role="status"><LoaderCircle size={18} className="spin"/><div><strong>正在诊断：{question}</strong><p>正在查询证据并生成解读，完成后会在这里更新。下方暂时保留已有结果。</p></div></div>}{diagnosisError&&!busy&&<div className="error-notice" role="alert"><AlertTriangle size={17}/>{diagnosisError}<button className="text-button" onClick={()=>ask(question)}>重试</button></div>}{result&&<section className="diagnosis-answer" aria-live="polite"><div className="answer-label"><Sparkles size={16}/>{result.mode==="llm"?"AI 解读":"研究路径"}{result.blocked&&<span className="status-label unknown">边界保护</span>}</div><p className="answer-summary">{result.summary}</p><p className="answer-reason">维度选择：{result.reason}</p>{result.mode==="llm"&&<div className="integrated-related"><span>解读依据</span>{result.ids.map(id=><button key={id} onClick={()=>openEvidence(id)}>{id} <ArrowUpRight size={12}/></button>)}</div>}<div className="mode-notice">{result.notice}</div></section>}<div className="finding-list">{visible.map(card)}</div>{result&&<div className="followups"><h3>沿着证据继续研究</h3>{result.followups.map(q=><button key={q} disabled={busy} onClick={()=>ask(q)}>{q}<ArrowRight size={15}/></button>)}</div>}</section>
 <aside className="insight-column"><section className="cash-chart"><div className="section-title"><h2>增长的两种速度</h2><Activity size={18}/></div><p>同比增速 · 2026 H1 vs 2025 H1</p>{[["营业收入",m.revenueGrowth],["归母净利润",m.profitGrowth],["经营现金流",m.cashGrowth]].map(([label,value])=><div className="bar-row" key={String(label)}><span>{label}</span><div><i style={{width:Number(value)/.6+"%"}}/></div><b>{fmt(Number(value))}%</b></div>)}<div className="chart-note">增速差异是继续研究的起点，尚不足以单独判定增长质量。</div><button className="text-button" onClick={()=>openEvidence("E02")}>检查计算依据 <ArrowUpRight size={14}/></button></section><section className="next-question"><span className="eyebrow">NEXT QUESTION</span><h3>现金流为什么没有<br/>跟上利润增长？</h3><p>核对营运资本变化、回款节奏与比较基数。</p><button disabled={busy} onClick={()=>ask("现金流为什么没有跟上利润增长？")}>带着这个问题继续 <ArrowRight size={16}/></button></section><section className="coverage"><h3>诊断覆盖</h3>{[["经营质量 / 财务趋势","公告支持"],["行业位置 / 事件风险","有限证据"],["估值 / 历史行情",catalog.some(e=>e.id==="V01"||e.id==="H01")?"已纳入本轮":status?.chatPreview?"查询状态见上方":"待接入"]].map(([label,state])=><div key={label}><span>{label}</span><b className={state==="待接入"?"missing":""}>{state}</b></div>)}</section><div className="scope-note"><ShieldCheck size={17}/><p>财报、行情与媒体资料各有时点。近期新闻补充事件线索，尚不代表原文已核验或事件已兑现。</p></div></aside></div></TabsContent>
 <TabsContent value="evidence"><div className="evidence-toolbar"><div className="evidence-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索结论、维度或证据编号" aria-label="搜索证据"/></div><Select value={filter} onValueChange={setFilter}><SelectTrigger aria-label="筛选证据类型"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">全部证据</SelectItem>{Object.entries(typeLabels).map(([key,label])=><SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select><span className="evidence-count">{evidenceList.length} 条 · 已核验 {catalog.filter(e=>reviewed.includes(evidenceReviewKey(e))).length}/{catalog.length}</span></div><div className="evidence-card-grid">{evidenceList.map(card)}</div>{!evidenceList.length&&<div className="empty-state"><Search size={30}/><h3>没有找到匹配的证据</h3><p>试试“现金流”“毛利率”或清除筛选。</p><button className="secondary-button" onClick={()=>{setSearch("");setFilter("all");}}>清除筛选</button></div>}</TabsContent>
 {status?.chatPreview&&<TabsContent value="market"><MarketResearch onAsk={q=>setResearchQuestion({id:Date.now(),question:q})}/></TabsContent>}<TabsContent value="method"><section className="method-panel"><div className="section-title"><h2>可复核，比一个分数更重要</h2><span>{snapshot.id}</span></div><div className="method-steps"><div><Database size={21}/><h3>01 / 原始证据</h3><p>公开公告按原始字段录入，保留报告期、披露日、单位、页码与比较口径。</p></div><div><Braces size={21}/><h3>02 / 确定性计算</h3><p>代码计算增速、毛利率与现金流比值。缺失或分母非正数时停止计算。</p></div><div><Sparkles size={21}/><h3>03 / 问题解读</h3><p>模型连接后负责语义选维度、解释关系；无法连接时明确显示规则诊断。</p></div></div><div className="source-summary"><h3>资料范围与时效</h3><p>{snapshot.title} · {snapshot.audit}。数据期末 {snapshot.periodEnd}，披露 {snapshot.publishedAt}，本次核验 {snapshot.retrievedAt}。财务字段为冻结快照；诊断概览另行查询行情、估值和近期新闻，并逐项显示状态，未覆盖披露后全部事件。</p><p>金额原始单位为人民币千元；展示亿元时除以 100,000。财务同比使用上年同期，资产负债项目使用上年末。行业份额来自报告转引，不代表独立第三方验证。</p><a className="text-button" href={snapshot.source} target="_blank" rel="noreferrer">查看巨潮资讯原始公告 <ArrowUpRight size={14}/></a></div><div className="model-config"><span className="status-label unknown">{modeText}</span><p>模型配置仅存放在服务端。规则模式可以核对证据，但不具备开放式语言模型理解能力。</p></div><h3 className="raw-title">原始字段与可追溯位置</h3><Table><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>本期原始值</TableHead><TableHead>比较期值</TableHead><TableHead>单位 / 比较口径</TableHead><TableHead>来源</TableHead></TableRow></TableHeader><TableBody>{fields.map(f=><TableRow key={f.id}><TableCell>{f.label}<code className="field-code">{f.id}</code></TableCell><TableCell>{f.current===null?<span className="missing">未获得</span>:fmt(f.current,Number.isInteger(f.current)?0:2)}</TableCell><TableCell>{f.previous===null?"—":fmt(f.previous,0)}</TableCell><TableCell>{f.unit}<br/><small>{f.comparison}</small></TableCell><TableCell>{f.page?<a className="source-link" href={snapshot.source+"#page="+(f.page+1)} target="_blank" rel="noreferrer">报告 P{f.page} ↗</a>:"未接入"}</TableCell></TableRow>)}</TableBody></Table><div className="method-download"><button className="secondary-button" onClick={()=>download(JSON.stringify({snapshot,fields,calculations:metrics(),diagnosis:result,catalog},null,2),"证研-原始字段与计算.json","application/json")}><Download size={16}/> 下载原始字段与计算</button></div><h3>已知边界</h3><p>仅支持宁德时代；财务依据公开公告快照。本地诊断将同花顺扶摇价格、估值、前复权日线与 iFinD 新闻纳入同一证据目录；是否取得数据，以本轮资料状态和各自时点为准。同行完整对比仍未接入，新闻片段尚需原文核实。没有自动事件监控。模型输出可能有解释误差，需要沿原文验证。</p></section></TabsContent></Tabs>
 <footer className="page-footer"><span>证研 / 把判断建立在证据上</span><span>公开资料研究，不提供买卖指令</span></footer></main></SidebarProvider>
 {status?.chatPreview&&<StockChat researchQuestion={researchQuestion} onOpenEvidence={openEvidence} market={market} onMarketChange={setMarket} onOpenMarket={()=>{const panel=document.getElementById("market-quote");panel?.focus({preventScroll:true});panel?.scrollIntoView({behavior:"smooth",block:"center"});}}/>}
 <Sheet open={!!selected} onOpenChange={open=>{if(!open){selectedRef.current=null;setSelected(null);setCopied(false);}}}><SheetContent className="evidence-sheet"><SheetHeader><span className="eyebrow">EVIDENCE TRACE / {selected?.id}</span><SheetTitle>{selected?.title}</SheetTitle><SheetDescription>资料来源 → 确定性计算 → 分析推断 → 验证边界</SheetDescription></SheetHeader>{selected&&<EvidenceTrace item={selected} reviewed={reviewed.includes(evidenceReviewKey(selected))} onReview={toggleReviewed} onOpen={openEvidence} onAsk={ask} busy={busy}/>}</SheetContent></Sheet></div>;
}
