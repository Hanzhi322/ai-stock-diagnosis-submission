import type { ChatFact } from "./stock-chat";
import type { ChatSource } from "./chat-context";
import { fields, snapshot } from "./research";

export type ResearchTool = "get_stock_summary" | "get_security_indicators" | "search_notice" | "search_news";
export type ResearchSource = ChatSource & { category: "company" | "financial" | "notice" | "news"; warnings: string[]; conflict: boolean };
export type ResearchResult = {
  status: "ok" | "unavailable"; sources: ResearchSource[]; facts: Record<string, ChatFact>;
  fetchedAt: number; queries: { tool: ResearchTool; query: string; ok: boolean }[]; message?: string; code?: string;
};
export type ResearchLookup = { tool: ResearchTool; query: string; size?: number; time_start?: string; time_end?: string; market?: "A股" };
export const researchTools: ResearchTool[] = ["get_stock_summary", "get_security_indicators", "search_notice", "search_news"];
export const isCoverageQuestion = (q: string) => /还缺|缺哪些|哪些关键信息|数据缺口|还需要|不确定性|了解这家公司|全面|整体|综合/.test(q);
export const isSimpleChat = (q: string) => /^(?:hi|hello|hey|你好|您好|在吗|在么|嗨|哈喽|谢谢|好的|嗯|你在吗|hi在吗)[！!？?。\s]*$/i.test(q) ||
  /^(?:请|帮我|解释一下|解释|说说|告诉我)?[^？?。！!]{0,20}(?:是什么意思|是什么含义|是什么概念|是啥意思)[？?。]*$/.test(q);

export function researchLookup(tool: ResearchTool, question: string, now = Date.now()): ResearchLookup {
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(t);
  const q = question.trim().slice(0, 450);
  const query = `宁德时代（300750.SZ）：${q}`;
  if (tool === "get_stock_summary") return {tool,query:"宁德时代主营业务"};
  if (tool === "get_security_indicators") return {tool,market:"A股",query};
  const years = [...q.matchAll(/\b(20\d{2})\s*年/g)].map(m=>Number(m[1])).filter(y=>y>=2000&&y<=Number(day(now).slice(0,4)));
  return {tool,query,size:3,time_start:years.length ? `${Math.min(...years)}-01-01` : day(now-(tool==="search_news"?30:365)*86400000),time_end:day(now)};
}

// The last two user messages carry topic context, never factual authority.
export function planResearch(question: string, now = Date.now()): ResearchLookup[] {
  if (isSimpleChat(question)) return [];
  const coverage = isCoverageQuestion(question);
  const financial = /财务|利润|现金流|收入|营收|增长|负债|毛利|净利|存货|应收|分红|财报/.test(question);
  const news = /新闻|资讯|新消息|发生了什么|利好|利空|传闻/.test(question);
  const announcement = coverage || /公告|财报|年报|季报|半年报|为什么|原因|订单|产能|工厂|客户|竞争|风险|研发|技术|分红|派息|回购|项目|扩产|兑现/.test(question);
  const out: ResearchLookup[] = [];
  if (coverage || financial) out.push(researchLookup("get_security_indicators",coverage ? `截至${new Date(now).toISOString().slice(0,10)}最新已披露报告期的营业收入、归母净利润、经营活动产生的现金流量净额，请返回具体报告期及单位。` : question,now));
  if (news) out.push(researchLookup("search_news",question,now));
  if (announcement && out.length<2 && (!news||/公告|核实|属实|是真的吗|证实|求证|原文/.test(question))) out.push(researchLookup("search_notice",coverage ? "半年度报告 经营风险 现金流" : question,now));
  if (!out.length && !/股价|走势|回撤|估值|市盈|市净|PE\b|PB\b/i.test(question)) out.push(researchLookup("get_stock_summary",question,now));
  return out.slice(0,2);
}

const metricPatterns: [string, RegExp][] = [["revenue",/营业收入|营收/],["profit",/归属.*(?:母公司|上市公司|股东).*净利润|归母净利润/],["cashflow",/经营活动产生的现金流量净额|经营现金流/]];
function money(text: string): number | null {
  const m = /(-?[\d,]+(?:\.\d+)?)\s*(亿元|亿|千元|万元|元)/.exec(text);
  if (!m) return null;
  return Number(m[1].replaceAll(",","")) * ({"亿元":1e8,"亿":1e8,"千元":1e3,"万元":1e4,"元":1} as Record<string,number>)[m[2]];
}
export function snapshotConflict(title: string, text: string): boolean {
  // Compare only the same explicitly named report. Other periods are not errors.
  if (!new RegExp(`${snapshot.periodEnd.slice(0,4)}年?(?:半年度|半年|中期|上半年)`).test(title.replace(/\s/g,""))) return false;
  return text.split(/[。；\n]/).some(line => metricPatterns.some(([key,pattern]) => {
    const m = pattern.exec(line); if (!m) return false;
    const afterMetric=line.slice(m.index + m[0].length);
    if(/^(?:较|比|同比|增加|减少|增长|下降)/.test(afterMetric.trim()))return false;
    const value = money(afterMetric);
    const original = fields.find(f=>f.id===key)?.current;
    return value !== null && original != null && Math.abs(value/(original*1000)-1) > .05;
  }));
}

function safeUrl(value: unknown): string | null {
  if(typeof value!=="string")return null;
  try { const u=new URL(value);return ["http:","https:"].includes(u.protocol)&&!u.username&&!u.password&&!/(?:key|token|secret|cookie|authorization)=/i.test(u.search)&&u.hostname.includes(".")&&!u.hostname.endsWith(".local")&&! /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname)?u.href:null; } catch{return null;}
}
export function parseResearchTool(tool: ResearchTool, raw: unknown, lookup: ResearchLookup, now = Date.now()): Pick<ResearchResult,"sources"|"facts"> {
  const envelope = typeof raw==="string" ? JSON.parse(raw) : raw;
  if (!envelope || envelope.code!==1 || envelope.msg!=="success") throw Error("TOOL_RESULT");
  const sources: ResearchSource[]=[]; const facts: Record<string,ChatFact>={};
  const fetched = new Date(now).toISOString();
  if (tool==="search_news" || tool==="search_notice") {
    let rows = envelope.data?.data ?? envelope.data;
    if(typeof rows==="string") rows=JSON.parse(rows);
    if(!Array.isArray(rows))throw Error("SCHEMA");
    for(const row of rows) {
      const title = row?.[tool==="search_notice"?"公告标题":"资讯标题"];
      const text = row?.[tool==="search_notice"?"公告片段内容":"资讯内容"];
      if(typeof title!=="string"||typeof text!=="string"||!title.trim()||!text.trim())continue;
      const date=typeof row["日期"]==="string"?row["日期"]:"";
      if(date && lookup.time_start && (date<lookup.time_start || date>lookup.time_end!))continue;
      const conflict=snapshotConflict(title,text);
      const url=safeUrl(row.URL||row.url);
      const id=`${tool==="search_notice"?"A":"N"}${String(sources.length+1).padStart(2,"0")}`;
      sources.push({id,title:title.slice(0,220),text:text.slice(0,2400),url:url||"https://mcp.51ifind.com/",linkLabel:url?"打开原文":"打开 iFinD 检索服务",category:tool==="search_notice"?"notice":"news",conflict,
        timing:`${date?`发布 ${date}；`:""}获取 ${fetched}`,
        warnings:[tool==="search_notice"?"检索返回的公告片段，仍需核对披露原文。":"媒体线索，不等同于已核实事实。",...(!url?["工具未返回原文链接。"]:[]),...(conflict?["片段金额与同报告期财报字段不一致，暂不采用其中数字。"]:[])]});
      if(/^20\d{2}-\d{2}-\d{2}$/.test(date)){
        const key=`research.${id}.date`;
        facts[key]={key,label:`${id} 发布日期`,value:date,period:"发表日期，不一定是事件发生日期",sourceUrl:url||"https://mcp.51ifind.com/",page:0};
      }
      const dates=[...new Set(text.match(/(?:20\d{2}年)?\d{1,2}月(?:\d{1,2}日)?/g)||[])].slice(0,6);
      for(const [index,value] of dates.entries()){
        const key=`research.${id}.date${index+1}`;
        facts[key]={key,label:`${id} 原文提及日期`,value,period:`发布 ${date||"时间不明"}；日期按片段原样保留`,sourceUrl:url||"https://mcp.51ifind.com/",page:0};
      }
      if(!conflict){
        const seen=new Set<string>();
        for(const match of text.matchAll(/(?<![\d.])(-?\d+(?:\.\d+)?)\s*(亿元|万元|千元|亿|个百分点|%|％|GWh|Ah|元\/Wh)/g)){
          const value=`${match[1]} ${match[2]==="亿"?"亿元":match[2]==="％"?"%":match[2]}`;
          if(seen.has(value))continue;seen.add(value);
          const key=`research.${id}.n${seen.size}`;
          facts[key]={key,label:`${id} 片段转述：${text.slice(Math.max(0,match.index!-18),match.index!+match[0].length+10)}`,value,period:`发布 ${date||"时间不明"}；待核对原文口径`,sourceUrl:url||"https://mcp.51ifind.com/",page:0};
          if(seen.size>=8)break;
        }
      }
      if(sources.length>=3)break;
    }
  } else {
    const data=envelope.data;
    const text = typeof data==="string"?data:typeof data?.answer==="string"?data.answer:JSON.stringify(data);
    if(!text || text==="null" || text==="{}" || /未能识别|没有找到|未找到|无查询结果|查询失败|暂无数据/.test(text))throw Error("NO_RESULTS");
    const id=tool==="get_stock_summary"?"B01":"F01";
    const parameters=typeof data==="object"?data.indicators_params:undefined;
    const periods=[...new Set(Object.values(parameters||{}).flatMap(p=>{
      const period=p&&typeof p==="object"?(p as Record<string,unknown>)["报告期"]:undefined;
      return typeof period==="string"?[period]:[];
    }))];
    let period=periods.join("；")||"接口未标明具体报告期";
    sources.push({id,title:tool==="get_stock_summary"?"宁德时代公司信息 · iFinD":"宁德时代财务指标 · iFinD",url:"https://mcp.51ifind.com/",linkLabel:"打开 iFinD 数据服务",text:text.slice(0,5000),category:tool==="get_stock_summary"?"company":"financial",conflict:false,timing:`${period}；获取 ${fetched}`,warnings:["数值与期间以接口原样返回为准；期次不明时不作跨期比较。"]});
    if(tool==="get_security_indicators") {
      const lines=text.split("\n").filter((s:string)=>s.trim().startsWith("|"));
      const columns=(line:string)=>line.split("|").slice(1,-1).map(s=>s.trim());
      if(lines.length>=3) {
        const names=columns(lines[0]);
        const row=lines.slice(2).map(columns).find((r:string[])=>r.some(v=>v==="300750.SZ"||v==="宁德时代"));
        const dateColumn=names.findIndex((s:string)=>/^(日期|报告期|报告日期)$/.test(s));
        const dateCell=row?.[dateColumn];
        const explicitDate=typeof dateCell==="string"?/^(20\d{2})[-/]?(\d{2})[-/]?(\d{2})$/.exec(dateCell):null;
        if(explicitDate){
          period=`${explicitDate[1]}-${explicitDate[2]}-${explicitDate[3]}（接口返回日期）`;
          sources[0].timing=`${period}；获取 ${fetched}`;
          if(period.slice(0,10)<snapshot.periodEnd)sources[0].warnings.push("返回日期早于已有财报，不作为最新财务状态。");
          if(period.slice(0,10)>new Date(now).toISOString().slice(0,10)){
            sources[0].conflict=true;
            sources[0].warnings.push("接口日期晚于查询时间，期次不能确认，暂不采用数值。");
          }
        }
        if(row&&!sources[0].conflict) for(let i=0;i<Math.min(names.length,row.length);i++) {
          const cell=row[i].replaceAll(",","");
          if(!/^-?\d+(?:\.\d+)?(?:亿|万|千)?%?$/.test(cell))continue;
          const label=names[i].replace(/[（(]单位[：:].*?[）)]/g,"").trim();
          if(/证券代码|证券简称/.test(label))continue;
          const explicit=/(-?\d+(?:\.\d+)?)(亿|万|千|%)?$/.exec(cell)!;
          const unit=explicit[2]==="亿"?"亿元":explicit[2]==="万"?"万元":explicit[2]==="千"?"千元":explicit[2]==="%"?"%":/[（(]单位[：:]\s*([^）)]+)[）)]/.exec(names[i])?.[1].trim();
          if(!unit)continue;
          const key=`research.F01.n${i}`;
          facts[key]={key,label,value:`${explicit[1]} ${unit}`,page:0,period,sourceUrl:"https://mcp.51ifind.com/"};
        }
      }
    }
  }
  return {sources,facts};
}
