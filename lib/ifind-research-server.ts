import { readMcpResponse } from "./ifind-server";
import { parseResearchTool, planResearch, researchLookup, researchTools, type ResearchLookup, type ResearchResult, type ResearchTool } from "./ifind-research";

const endpoint="https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-mcp";
const empty=(code:string,message:string):ResearchResult=>({status:"unavailable",code,message,sources:[],facts:{},queries:[],fetchedAt:Date.now()});
const cache=new Map<string,{credential:string;until:number;value:ResearchResult}>();
const pending=new Map<string,{credential:string;promise:Promise<ResearchResult>}>();

async function query(lookups:ResearchLookup[],key:string,signal:AbortSignal):Promise<ResearchResult>{
  let session:string|null=null,sequence=0;
  const headers=()=>({"Content-Type":"application/json",Accept:"application/json, text/event-stream",Authorization:key,...(session?{"Mcp-Session-Id":session}:{})});
  const send=(body:string)=>process.env.IFIND_TRANSPORT==="direct-tls"?
    import("./ifind-transport").then(m=>m.postIfindMcp(headers(),body,signal,"finance")):
    fetch(endpoint,{method:"POST",headers:headers(),body,signal,redirect:"manual"});
  const rpc=async(method:string,params:unknown)=>{
    const id=++sequence,r=await send(JSON.stringify({jsonrpc:"2.0",id,method,params}));
    if(!r.ok){await r.body?.cancel();throw Error(r.status===429?"RATE_LIMIT":r.status===401||r.status===403?"AUTH_REQUIRED":"UPSTREAM_ERROR");}
    session=r.headers.get("mcp-session-id")||session;
    const body=await readMcpResponse(r,id);
    if(body.error)throw Error("MCP_ERROR");
    return body.result;
  };
  try{
    await rpc("initialize",{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"zhengyan-research",version:"0.2.0"}});
    const ready=await send(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"}));await ready.body?.cancel();if(!ready.ok)throw Error("MCP_ERROR");
    const listing=await rpc("tools/list",{}) as {tools?:{name:string;inputSchema?:{required?:string[]}}[]};
    const tools=Array.isArray(listing?.tools)?listing.tools:[];
    const pieces=await Promise.all(lookups.map(async lookup=>{
      try{
        const tool=tools.find(t=>t.name===lookup.tool);if(!tool)throw Error("TOOL_UNAVAILABLE");
        const {tool:name,...args}=lookup;
        if((tool.inputSchema?.required||[]).some((k:string)=>!Object.hasOwn(args,k)))throw Error("SCHEMA");
        const result=await rpc("tools/call",{name,arguments:args}) as {isError?:boolean;content?:{type:unknown;text?:unknown}[]};
        if(result?.isError)throw Error("TOOL_ERROR");
        const raw=(result?.content||[]).flatMap(c=>c.type==="text"&&typeof c.text==="string"?[c.text]:[]).join("\n");
        if(raw.includes(key)||raw.includes(key.replace(/^Bearer\s+/i,"")))throw Error("SECRET_ECHO");
        const parsed=parseResearchTool(name,raw,lookup);
        return {...parsed,tool:name,query:lookup.query,ok:parsed.sources.length>0};
      }catch{return {sources:[],facts:{},tool:lookup.tool,query:lookup.query,ok:false};}
    }));
    const sources=pieces.flatMap(p=>p.sources),facts=Object.assign({},...pieces.map(p=>p.facts));
    return {status:sources.length?"ok":"unavailable",sources,facts,queries:pieces.map(({tool,query,ok})=>({tool,query,ok})),fetchedAt:Date.now(),
      ...(!sources.length?{code:"NO_RESULTS",message:"这次相关信息暂未查询成功，可以稍后再试。"}:{})};
  }catch(error){
    const code=signal.aborted?"TIMEOUT":error instanceof Error?error.message:"CONNECTION_ERROR";
    return empty(code,code==="RATE_LIMIT"?"数据服务正在限流，请稍后重试。":code==="AUTH_REQUIRED"?"这项信息当前暂时无法查询。":"这次相关信息暂未查询成功，可以稍后再试。");
  }
}

export async function getIfindResearch(question:string, requestSignal?:AbortSignal, supplemental?:{tool:ResearchTool;query:string}):Promise<ResearchResult>{
  const key=process.env.IFIND_API_KEY?.trim();
  if(!key)return empty("NOT_CONFIGURED","这项在线查询当前不可用。");
  if(supplemental&&!researchTools.includes(supplemental.tool))return empty("INVALID_TOOL","暂时无法完成这项查询。");
  const lookups=supplemental?[researchLookup(supplemental.tool,supplemental.query)]:planResearch(question);
  if(!lookups.length)return empty("NOT_NEEDED","");
  const id=JSON.stringify(lookups),saved=cache.get(id);
  if(saved?.credential===key&&saved.until>Date.now())return saved.value;
  const active=pending.get(id);if(active?.credential===key)return active.promise;
  const signal=AbortSignal.any([AbortSignal.timeout(16000),...(requestSignal?[requestSignal]:[])]);
  const promise=query(lookups,key,signal).then(value=>{
    if(cache.size>80)cache.delete(cache.keys().next().value!);
    cache.set(id,{credential:key,until:Date.now()+(value.status==="ok"?300000:10000),value});return value;
  });
  const entry={credential:key,promise};pending.set(id,entry);
  try{return await promise;}finally{if(pending.get(id)===entry)pending.delete(id);}
}

export function mergeResearch(first:ResearchResult|undefined,second:ResearchResult):ResearchResult{
  if(!first)return second;
  // A tool's new result replaces its prior sources, keeping IDs and facts aligned.
  const prefixes=new Set(second.sources.map(s=>s.id[0]));
  const sources=[...first.sources.filter(s=>!prefixes.has(s.id[0])),...second.sources];
  const facts={...Object.fromEntries(Object.entries(first.facts).filter(([k])=>!prefixes.has(k.split(".")[1]?.[0]))),...second.facts};
  return {status:sources.length?"ok":"unavailable",sources,facts,fetchedAt:second.fetchedAt,queries:[...first.queries,...second.queries],...(!sources.length?{message:second.message,code:second.code}:{})};
}
