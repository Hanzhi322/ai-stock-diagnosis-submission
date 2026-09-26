import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/integrated-diagnosis.ts','lib/research.ts','app/api/diagnose/route.ts'],outdir:'.sites-runtime/integrated-tests',outbase:'.',bundle:true,format:'esm',platform:'node',alias:{'@':'./'},logLevel:'silent'});
const {integratedDiagnosis,overviewQuestion}=await import('../.sites-runtime/integrated-tests/lib/integrated-diagnosis.js');
const {exportResearch,evidenceReviewKey}=await import('../.sites-runtime/integrated-tests/lib/research.js');
const {POST,GET}=await import('../.sites-runtime/integrated-tests/app/api/diagnose/route.js');
const now=Date.now(),day=86400000;
const missing={status:'unavailable',code:'TEST_FAILURE',message:'测试接口失败'};
const article=(id,conflict=false)=>({id,title:conflict?'同文数字冲突':'业务进展线索',excerpt:conflict?'同一片段有矛盾金额':'媒体称正在推进项目，尚未核实。',publishedAt:'2026-09-25',url:'https://example.com/'+id,source:'example.com',warnings:["媒体报道片段，未独立核实原文",...(conflict?['同一片段出现不同的动力电池收入数值']:[])]});
const context={market:{status:'ok',cached:false,quote:{symbol:'300750.SZ',currency:'CNY',lastPrice:300,changePct:-2,previousClose:306.12,fetchedAt:now,sourceTimestamp:now,requestId:'test-quote'}},history:{status:'ok',bars:[{date:now-3*day,close:400},{date:now-day,close:300}],fetchedAt:now,sourceTimestamp:now,requestId:'test-history',changePct:-25,maxDrawdownPct:-25,start:now-3*day,end:now-day,count:2},valuation:{status:'ok',fetchedAt:now,sourceTimestamp:now,requestId:'test-valuation',pe_ttm:20,pe_mrq:19,pb_mrq:4,ps_ttm:5,pcf_ttm:6},news:{status:'ok',text:'',fetchedAt:now,from:'2026-09-21',to:'2026-09-27',tool:'search_news',links:[],articles:[article('N01'),article('N02',true)]}};
const card=(r,id)=>r.catalog.find(e=>e.id===id);

test('综合诊断纳入价格、估值、走势和新闻，并保留经营与现金流反证',()=>{
 const r=integratedDiagnosis(overviewQuestion,context,now);
 for(const id of ['E01','E02','E03','E04','M01','H01','V01','N01','N02','X01'])assert.ok(r.ids.includes(id),id);
 assert.match(card(r,'E04').fact,/本次已取得：价格快照、前复权日线、估值快照、近期新闻检索/);
 assert.doesNotMatch(card(r,'E04').fact,/需另行查询|尚未接入/);
 assert.equal(card(r,'X01').type,'conflict');assert.match(card(r,'X01').boundary,/不是同一期间/);
 assert.equal(card(r,'N01').type,'neutral');assert.equal(card(r,'N02').type,'conflict');
 assert.equal(card(r,'H01').rawFields.filter(f=>f.label.includes('close_price')).length,2);
 assert.equal(card(r,'V01').rawFields[0].value,20);
});
test('缺失、旧时点与无新闻不能被包装成完整或正常诊断',()=>{
 const none=integratedDiagnosis(overviewQuestion,{market:missing,history:missing,valuation:missing,news:missing},now);
 assert.equal(none.catalog.some(e=>['M01','H01','V01','N01','X01'].includes(e.id)),false);
 assert.equal(none.dataStatus.filter(s=>s.status==='unavailable').length,4);
 assert.match(none.summary,/暂不作价格趋势判断/);assert.match(none.summary,/不能据此认定近期无重大事件/);
 const partial=integratedDiagnosis(overviewQuestion,{...context,market:{...context.market,quote:{...context.market.quote,sourceTimestamp:now-day}},valuation:{...context.valuation,pe_ttm:null,pb_mrq:-5},news:{...context.news,articles:[]}},now);
 assert.equal(partial.dataStatus.find(s=>s.id==='market').status,'partial');
 assert.equal(partial.dataStatus.find(s=>s.id==='valuation').status,'partial');
 assert.equal(partial.dataStatus.find(s=>s.id==='news').status,'unavailable');
 assert.match(card(partial,'V01').fact,/未获得/);assert.match(card(partial,'V01').fact,/-5.00/);
});
test('上涨区间不强制生成冲突；导出和核验标记绑定本轮数据版本',()=>{
 const first=integratedDiagnosis(overviewQuestion,context,now);
 const second=integratedDiagnosis(overviewQuestion,{...context,history:{...context.history,changePct:10},news:{...context.news,fetchedAt:now+1000,articles:[{...article('N01'),title:'下一轮完全不同的新闻'}]}},now+1000);
 assert.equal(card(second,'X01').type,'neutral');
 assert.notEqual(evidenceReviewKey(card(first,'N01')),evidenceReviewKey(card(second,'N01')));
 assert.match(exportResearch(first),/业务进展线索/);assert.doesNotMatch(exportResearch(first),/下一轮完全不同/);
 assert.match(exportResearch(first),/https:\/\/example.com\/N01/);assert.match(exportResearch(first),/test-history/);
 assert.match(exportResearch(first),/20 \| 倍/);
});

const saved=Object.fromEntries(['ENABLE_CHAT_PREVIEW','LLM_API_KEY','FUYAO_API_KEY','IFIND_API_KEY'].map(k=>[k,process.env[k]]));
const original=globalThis.fetch;
afterEach(()=>{globalThis.fetch=original;for(const [k,v]of Object.entries(saved))v===undefined?delete process.env[k]:process.env[k]=v;});
const request=q=>new Request('http://localhost/api/diagnose',{method:'POST',body:JSON.stringify({question:q})});
function mockProviders(){
 let modelInput='',modelCalls=0;
 process.env.ENABLE_CHAT_PREVIEW='true';process.env.LLM_API_KEY='test-llm';process.env.FUYAO_API_KEY='test-fuyao-integrated';process.env.IFIND_API_KEY='test-ifind-integrated';
 globalThis.fetch=async(url,options)=>{
  if(url.includes('/chat/completions')){modelCalls++;modelInput=JSON.parse(options.body).messages[0].content;return Response.json({choices:[{message:{content:JSON.stringify({ids:['X01','V01','N01'],summary:'财报增长与区间价格走弱应分期对照。估值指标已取得，但缺少可比基准。媒体报道仅为线索，不能说明事件已兑现。',reason:'电池制造业应交叉核对盈利、市场定价与事件。'})}}]});}
  if(url.includes('/historical'))return Response.json({code:0,data:{timestamp:now,item:[{date_ms:now-2*day,close_price:400},{date_ms:now-day,close_price:300}]}});
  if(url.includes('/valuations/'))return Response.json({code:0,data:{timestamp:now,item:[{thscode:'300750.SZ',pe_ttm:20,pe_mrq:19,pb_mrq:4,ps_ttm:5,pcf_ttm:6}]}});
  if(url.includes('fuyao.'))return new Response('temporarily unavailable',{status:503});
  const body=JSON.parse(options.body);const id=body.id;
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  if(body.method==='initialize')return Response.json({id,result:{protocolVersion:'2024-11-05'}});
  if(body.method==='tools/list')return Response.json({id,result:{tools:[{name:'search_news',inputSchema:{properties:{query:{type:'string'},size:{type:'number'},time_start:{type:'string'},time_end:{type:'string'}},required:['query','size','time_start','time_end']}}]}});
  return Response.json({id,result:{content:[{type:'text',text:JSON.stringify({code:1,msg:'success',data:{data:JSON.stringify([{资讯标题:'本轮项目新闻',资讯内容:'媒体称项目仍在推进，不能推断已经投产。',日期:body.params.arguments.time_end,URL:'https://example.com/current'}])}})}]}});
 };
 return {input:()=>modelInput,calls:()=>modelCalls};
}
test('真实 API 路径：GET 只查询，POST 将本轮多来源证据送入模型并保留失败与反证',async()=>{
 const spy=mockProviders();const overview=await(await GET()).json();assert.equal(spy.calls(),0);assert.equal(overview.mode,'rules');
 const result=await(await POST(request(overviewQuestion))).json();assert.equal(result.mode,'llm');assert.equal(spy.calls(),1);
 for(const id of ['X01','H01','V01','N01'])assert.ok(spy.input().includes('"id":"'+id+'"'));
 assert.match(spy.input(),/本轮项目新闻/);assert.match(spy.input(),/20.00/);
 assert.equal(result.catalog.some(e=>e.id==='M01'),false);assert.equal(result.dataStatus.find(s=>s.id==='market').status,'unavailable');
 assert.ok(result.ids.includes('E02'));assert.ok(result.ids.includes('E04'));assert.ok(result.ids.includes('E03'));
 assert.equal(JSON.stringify(result).includes('test-llm'),false);assert.equal(JSON.stringify(result).includes('test-ifind-integrated'),false);
});
test('交易边界不触发数据或模型请求；未开启预览不提供新 GET',async()=>{
 mockProviders();globalThis.fetch=async()=>{throw Error('should not call');};
 const result=await(await POST(request('请告诉我买入目标价'))).json();assert.equal(result.blocked,true);
 delete process.env.ENABLE_CHAT_PREVIEW;assert.equal((await GET()).status,404);
});
