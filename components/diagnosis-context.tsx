"use client";
import { Clock3, RefreshCw, ArrowUpRight, ArrowRight, Braces, Check } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { snapshot, fields, fmt, type Diagnosis, type Evidence } from "@/lib/research";

export function DiagnosisContext({result,loading,error,onRefresh,disabled}:{result:Diagnosis|null;loading:boolean;error:string;onRefresh:()=>void;disabled:boolean}){
 return <section className="diagnosis-context" aria-label="本次诊断资料" aria-busy={loading}>
  <div className="diagnosis-context-head"><div><Clock3 size={17}/><strong>本次诊断使用的资料</strong><span>各自标注时点，不混用期间</span></div><button disabled={disabled||loading} onClick={onRefresh}><RefreshCw size={14} className={loading?"spin":""}/>{loading?"查询中":"更新资料"}</button></div>
  {loading&&<p role="status">正在查询行情、估值、历史日线与新闻。已有结果保留至查询完成。</p>}
  {error&&<p role="alert" className="missing">{error}</p>}
  {result?.dataStatus&&<div className="diagnosis-data-grid">{result.dataStatus.map(s=><div key={s.id}><div><strong>{s.label}</strong><span className={s.status==="ok"?"source-ok":"source-partial"}>{s.status==="ok"?"已取得":s.status==="partial"?"待补充 / 核验":"未取得"}</span></div><b>{s.timing}</b><p>{s.detail}</p></div>)}</div>}
  {result?.generatedAt&&<div className="diagnosis-context-time">本轮整理于 {new Date(result.generatedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})}（北京时间）· 上游可能返回缓存，更新资料后需重新生成 AI 解读</div>}
 </section>;
}

export function EvidenceTrace({item,reviewed,onReview,onOpen,onAsk,busy}:{item:Evidence;reviewed:boolean;onReview:()=>void;onOpen:(id:string)=>unknown;onAsk:(question:string)=>void;busy:boolean}){
 const financialFields=item.fieldIds.flatMap(id=>fields.find(f=>f.id===id)??[]);
 return <div className="sheet-body"><div className="sheet-meta"><span className={"status-label "+item.type}>{item.label}</span><span>{item.dimension}</span></div>
 <section className="trace-block"><h3><span>01</span>{item.id.startsWith("N")?"媒体检索片段 · 待核验":item.sources?"本次取得的资料":"披露事实"}</h3><p>{item.fact}</p>
 {item.page>0&&<div className="source-chip">{snapshot.title} · 印刷页 {item.page}<br/>披露 {snapshot.publishedAt} · 核验 {snapshot.retrievedAt}</div>}
 {item.sources?.map((s,i)=><div className="source-chip integrated-source" key={i}><a href={s.url} target="_blank" rel="noreferrer">{s.label} <ArrowUpRight size={13}/></a><span>{s.timing}</span>{s.requestId&&<small>请求编号 {s.requestId}</small>}</div>)}
 </section>
 <section className="trace-block"><h3><span>02</span> 原始字段与计算</h3>
 {financialFields.length>0&&<Table><TableHeader><TableRow><TableHead>财报字段</TableHead><TableHead>本期</TableHead><TableHead>比较期</TableHead></TableRow></TableHeader><TableBody>{financialFields.map(f=><TableRow key={f.id}><TableCell>{f.label}<small>{f.unit} · {f.comparison}</small></TableCell><TableCell>{f.current===null?"未获得":fmt(f.current,Number.isInteger(f.current)?0:2)}</TableCell><TableCell>{f.previous===null?"—":fmt(f.previous,0)}</TableCell></TableRow>)}</TableBody></Table>}
 {item.rawFields&&<div className="integrated-raw-table"><Table><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>原值 / 单位</TableHead><TableHead>期间 / 口径</TableHead></TableRow></TableHeader><TableBody>{item.rawFields.map((f,i)=><TableRow key={i}><TableCell>{f.label}</TableCell><TableCell>{f.value??"未获得"}<small>{f.unit}</small></TableCell><TableCell>{f.period}</TableCell></TableRow>)}</TableBody></Table></div>}
 {!financialFields.length&&!item.rawFields?.length&&<p>未取得可供计算的原始字段。</p>}
 {item.formula&&<div className="formula"><Braces size={15}/><code>{item.formula}</code></div>}{financialFields.filter(f=>f.note).map(f=><p className="field-note" key={f.id}>{f.note}</p>)}
 </section><section className="trace-block"><h3><span>03</span> 分析推断</h3><p>{item.inference}</p><span className="inference-tag">规则推断 · 非原文结论</span></section>
 <section className="trace-block boundary"><h3><span>04</span> 反证与待验证</h3><p>{item.boundary}</p></section>
 {item.relatedIds&&<div className="integrated-related"><span>交叉核对</span>{item.relatedIds.map(id=><button key={id} onClick={()=>onOpen(id)}>{id} <ArrowRight size={13}/></button>)}</div>}
 <div className="sheet-actions">{item.page>0&&<a className="primary-button" href={snapshot.source+"#page="+(item.page+1)} target="_blank" rel="noreferrer">原始公告 P{item.page} <ArrowUpRight size={15}/></a>}<button className="secondary-button" onClick={onReview}><Check size={15}/>{reviewed?"撤销已核验":"标记已核验"}</button></div><p className="local-note">标记只保存在本浏览器，表示你已核对这份资料。动态资料更新后需重新核验。</p><button className="followup-single" disabled={busy} onClick={()=>onAsk(item.nextQuestion)}>{item.nextQuestion}<ArrowRight size={15}/></button>
 </div>;
}
