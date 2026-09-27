import { parseChatReply, userFollowups, type ChatReply } from "./stock-chat";
import { contextSources, type ChatContext } from "./chat-context";
import { evidence } from "./research";
import { isCoverageQuestion } from "./ifind-research";
import type { MarketResult } from "./market";

export type AnswerInspection = { reply: ChatReply | null; issues: string[] };

function availabilityIssue(text:string,market:MarketResult|undefined,context:ChatContext):string|undefined{
  if(/(?:没有|未提供|缺乏|缺少|未取得|未接入)[^。；\n]{0,18}(?:利润|现金流|毛利率|财务数据|财务报表|财报)/.test(text)&&
    !/(?:完整|更细|细分|最新季度|未来|后续|未披露|最近一期)/.test(text))return "已有半年报包含营收、利润、经营现金流与毛利率，不得称这些全部缺失";
  if(market?.status==="ok"&&/(?:没有|缺少|未接入|未取得)[^。；\n]{0,10}(?:行情|股价|价格快照)/.test(text))return "本轮已经取得行情";
  if(context.valuation?.status==="ok"&&/(?:没有|缺少|未接入)[^。；\n]{0,6}估值数据/.test(text))return "估值倍数已有，尚不能据此判断高低估";
  return undefined;
}
function numericTokens(text:string):string[]{return text.match(/(?<![A-Z])(?:[+-]?\d[\d,.]*\s*(?:亿元|万元|千元|元|%|％|倍|股|GWh)|\{\{[^{}]+\}\})/g)||[];}
function amountScopeIssue(text:string,context:ChatContext):string|undefined{
  for(const fact of Object.values(context.research?.facts||{})){
    if(!/片段转述/.test(fact.label)||!/(?:较上年|同比).{0,5}(?:增加|减少)/.test(fact.label))continue;
    const [number,unit]=fact.value.split(" ");
    const token=`{{${fact.key}}}`;
    const escaped=number.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const literal=new RegExp(`${escaped}\\s*${unit}`).exec(text);
    const at=text.includes(token)?text.indexOf(token):literal?.index;
    if(at===undefined||at<0)continue;
    if(!/(?:较|同比|增加|减少|多于|少于|变化|增减)/.test(text.slice(Math.max(0,at-24),at)))return "来源中的同比增减额不能写成当期总额或净额，请保留其比较口径";
  }
  return undefined;
}

// Inspect independent sentences, retaining their original paragraph grouping.
// A missing newline must not turn one unverified detail into a whole-answer failure.
export function inspectChatAnswer(value:unknown,market?:MarketResult,context:ChatContext={}):AnswerInspection{
  if(!value||typeof value!=="object")return {reply:null,issues:["没有可用的回答正文"]};
  const v=value as Record<string,unknown>;
  const allowed=new Set([...evidence.map(e=>e.id),...contextSources(context).map(s=>s.id),...(market?.status==="ok"?["M01"]:[])]);
  const paragraphs:{text:unknown;kind:unknown;ids:unknown}[]=Array.isArray(v.blocks)?v.blocks.slice(0,10).flatMap(b=>typeof b?.text==="string"?b.text.replace(/\\r\\n|\\n/g,"\n").split(/\n+/).map((text:string)=>({text,kind:b.kind??v.kind,ids:b.evidenceIds??v.evidenceIds})):[]):
    typeof v.answer==="string"?v.answer.replace(/\\r\\n|\\n/g,"\n").split(/\n+/).map((text:string)=>({text,kind:v.kind,ids:v.evidenceIds})):[];
  const blocks=paragraphs.flatMap((block,group)=>typeof block.text==="string"?block.text.split(/(?<=[。！？])\s*/).map(text=>({...block,text,group})):[]);
  const issues:string[]=[],good:(ChatReply & {group:number})[]=[];
  let removed=false;
  for(const block of blocks){
    if(typeof block.text!=="string"||!block.text.trim())continue;
    const text=block.text.replace(/\\r\\n|\\n/g,"\n").trim();
    if (/无可用回答正文|没有可用的回答正文|没有可用正文|(?:校验|修复|格式验证)(?:失败|通过)|请仅针对以下问题/.test(text)) {
      issues.push("请直接回答用户的问题，不输出内部处理提示");removed=true;continue;
    }
    if(removed&&/^(?:因此|所以|由此|综上|可见|这说明|这意味着|基于上述)/.test(text)){issues.push("前置依据暂未确认，相关推断需一起调整");continue;}
    const inaccurate=availabilityIssue(text,market,context)||amountScopeIssue(text,context);
    if(inaccurate){issues.push(inaccurate);removed=true;continue;}
    const declared=Array.isArray(block.ids)?block.ids.filter((id:unknown)=>typeof id==="string"):[];
    const inline=text.match(/\b[EMCHVNABF]\d{2}\b/g)||[];
    const tokenIds=[...text.matchAll(/\{\{(quote|history|valuation|company|news|research)\.([^{}]+)\}\}/g)].map(m=>
      m[1]==="quote"?"M01":m[1]==="history"?"H01":m[1]==="valuation"?"V01":m[1]==="company"?"C01":m[2].split(".")[0]);
    const ids=[...new Set([...declared,...inline,...tokenIds].filter(id=>allowed.has(id)))];
    if(market?.status==="ok"&&/最新成交价|前收|开盘价|最高价|最低价|行情快照/.test(text)&&!ids.includes("M01"))ids.push("M01");
    if(inline.some(id=>!allowed.has(id))){issues.push("正文引用了本轮不存在的来源编号");removed=true;continue;}
    if(!/(?:不能|无法|尚未|需核对|待验证)/.test(text)&&
      /(?:成交量|量能).{0,15}(?:活跃|放大|萎缩|缩量|放量|上升|下降)/.test(text)){
      issues.push("本轮没有成交量历史序列，单个快照不能证明量能变化");removed=true;continue;
    }
    if(!/(?:不能|无法|尚未|需核对|待验证)/.test(text)&&ids.length&&ids.every(id=>/^[HMV]/.test(id))&&
      /(?:营收|营业收入|净利润|毛利率).{0,20}(?:增长|下降|增加|上升)/.test(text)){
      issues.push("行情来源不能支持财务变化或财务原因，请仅使用财报或公告证据作这类判断");removed=true;continue;
    }
    if(ids.length&&ids.every(id=>/^[HMV]/.test(id))&&!/(?:不能|无法|尚未|可能|假设|需|待验证)/.test(text)&&
      /宏观.{0,30}(?:波动|下降|回落)|行业景气.{0,10}(?:下降|回落)|(?:导致|由于|受).{0,30}(?:股价|走势)|(?:投资者|市场).{0,8}(?:担忧|信心|恐慌|乐观)/.test(text)){
      issues.push("只有行情无法证实宏观归因、行业景气变化或投资者心理；保留历史走势描述，原因需另行核实");removed=true;continue;
    }
    const explicitIds=[...inline,...tokenIds];
    const conflict=context.research?.sources.some(s=>s.conflict&&(explicitIds.includes(s.id)||ids.length===1&&ids[0]===s.id));
    if(conflict&&numericTokens(text).length){issues.push("此段引用的公告摘要有金额冲突，请改用已核实财报或其他一致来源");removed=true;continue;}
    const kind=typeof block.kind==="string"&&["evidence","concept","unknown"].includes(block.kind)?block.kind:ids.length?"evidence":"concept";
    const reply=parseChatReply({answer:text,kind,evidenceIds:ids,followups:[]},market,context);
    if(reply){good.push({...reply,group:block.group});continue;}
    const tokens=numericTokens(text);
    issues.push(tokens.length?`此段有无法按指标、单位及来源确认的数值：${tokens.slice(0,4).join("、")}；保留可确认内容，无法确认部分改为定性说明`:
      "此段存在未确认的引用、格式或不适合提供的交易结论；不影响其他段落");
    removed=true;
  }
  if(!good.length)return {reply:null,issues:issues.length?issues:["回答中没有可用正文"]};
  const ids=[...new Set(good.flatMap(r=>r.evidenceIds))];
  const facts=[...new Map(good.flatMap(r=>r.facts).map(f=>[f.key,f])).values()];
  const grouped=new Map<number,string[]>();
  for(const reply of good)grouped.set(reply.group,[...(grouped.get(reply.group)||[]),reply.answer]);
  return {reply:{answer:[...grouped.values()].map(lines=>lines.join("")).join("\n\n"),kind:good.some(r=>r.kind==="evidence")?"evidence":good.some(r=>r.kind==="unknown")?"unknown":"concept",
    evidenceIds:ids,facts,followups:userFollowups(v.followups,ids),mode:"llm",sources:contextSources(context).filter(s=>ids.includes(s.id)),context,...(market?{market}:{}),
    ...(issues.length?{partial:true,notice:"其余部分暂时无法可靠确认，先保留以上能够核实的内容。"}:{})},issues};
}

export function evidenceFallback(question:string,market:MarketResult,context:ChatContext):ChatReply|null{
  if(isCoverageQuestion(question)){
    const obtained=["已核对半年报中的收入、利润、经营现金流和业务毛利率"];
    const ids=["E01","E02","E03"];
    if(market.status==="ok"){obtained.push("已取得独立行情快照");ids.push("M01");}
    if(context.valuation?.status==="ok"){obtained.push("已取得估值倍数");ids.push("V01");}
    const notice=context.research?.sources.find(s=>s.category==="notice"&&!s.conflict);
    if(notice){obtained.push("已检索到公司公告片段");ids.push(notice.id);}
    return {answer:`${obtained.join("；")}。\n\n下一步值得核实的是：业务增长能否持续、回款节奏如何变化，以及订单或扩产进展能否兑现为业绩。估值还需在同口径下比较同行与历史水平，已有倍数本身不能证明便宜或昂贵。`,kind:"unknown",evidenceIds:ids,facts:[],followups:["现金流和利润的变化说明什么？","最近公告有哪些值得关注的进展？"],mode:"data",sources:contextSources(context).filter(s=>ids.includes(s.id)),context,market,notice:"本次 AI 解读暂未完成，以上为已取得资料与研究要点的整理。"};
  }
  return null;
}
