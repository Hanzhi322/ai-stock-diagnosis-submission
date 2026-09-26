import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/market-analysis-server.ts','lib/market-analysis.ts','lib/ifind-server.ts','lib/chat-context.ts'],outdir:'.sites-runtime/context-tests',bundle:true,format:'esm',platform:'node',logLevel:'silent'});
const {parseHistory,parseValuation}=await import('../.sites-runtime/context-tests/market-analysis-server.js');
const {historyMetrics}=await import('../.sites-runtime/context-tests/market-analysis.js');
const {readMcpResponse,parseNewsContent,newsLinks,getNewsEvidence}=await import('../.sites-runtime/context-tests/ifind-server.js');
const {contextSources,neededResearch}=await import('../.sites-runtime/context-tests/chat-context.js');
const original=globalThis.fetch, originalKey=process.env.IFIND_API_KEY;
afterEach(()=>{globalThis.fetch=original;if(originalKey===undefined)delete process.env.IFIND_API_KEY;else process.env.IFIND_API_KEY=originalKey});
const now=Date.now();
test('历史计算排序、复权区间、回撤及缺失数据边界',()=>{
 const bars=[{date:1,close:100},{date:2,close:120},{date:3,close:90},{date:4,close:110}];
 const m=historyMetrics(bars); assert.ok(Math.abs(m.changePct-10)<1e-8);assert.equal(m.maxDrawdownPct,-25);
 const raw={code:0,data:{timestamp:now-86400000,item:[3,1,2].map(n=>({date_ms:now-n*86400000,close_price:100+n}))}};
 const result=parseHistory(raw,now);assert.equal(result.status,'ok');assert.equal(result.count,3);assert.ok(result.start<result.end);
 for(const items of [[],[{date_ms:now,close_price:0}],Array(2).fill({date_ms:now,close_price:100}),[{date_ms:now-86400000,close_price:100},{date_ms:now+86400000,close_price:101}]])assert.equal(parseHistory({code:0,data:{item:items}},now).status,'unavailable');
});
test('估值保留负值与空值，不补零也不判低估',()=>{
 const payload={code:0,data:{timestamp:null,item:[{thscode:'300750.SZ',pe_ttm:-5,pe_mrq:null,pb_mrq:3}]}};
 const v=parseValuation(payload,now);assert.equal(v.status,'ok');assert.equal(v.pe_ttm,-5);assert.equal(v.pe_mrq,null);assert.equal(v.ps_ttm,null);
 assert.equal(parseValuation({code:0,data:{item:[{thscode:'300750.SZ'}]}}).status,'unavailable');
 assert.equal(parseValuation({code:2003}).code,'FORBIDDEN');
 assert.match(contextSources({valuation:v}).find(s=>s.id==='V01').text,/负值不能解释为便宜/);
});
const article={资讯标题:'公司回应业务问题',资讯内容:'动力电池业务的营业收入为1921.25亿元。分业务看动力电池业务收入为165.06亿元，需核对期间。',日期:'2026-09-24',URL:'https://news.example.com/item'};
const envelope=rows=>JSON.stringify({code:1,msg:'success',data:{data:JSON.stringify(rows)}});
test('解析实际 iFinD 双层 JSON 契约，保留来源与同文冲突，过滤越界日期',()=>{
 const rows=parseNewsContent(envelope([article,{...article,资讯标题:'旧信息',日期:'2020-01-01'},{备注:'片段不是全文'}]),'2026-09-21','2026-09-27');
 assert.equal(rows.length,1);assert.equal(rows[0].url,article.URL);assert.equal(rows[0].id,'N01');assert.ok(rows[0].warnings.some(x=>x.includes('不同的动力电池收入')));
 assert.throws(()=>parseNewsContent(JSON.stringify({code:0,msg:'fail'}),'2026-09-21','2026-09-27'));
 assert.deepEqual(newsLinks('https://127.0.0.1/a https://news.example.com/x?token=secret http://news.10jqka.com.cn/article'),['http://news.10jqka.com.cn/article']);
});
test('MCP SSE 只读取对应响应，JSON 编号不匹配不能误用',async()=>{
 const body='event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:2,result:{ok:true}})+'\n\n';
 const parsed=await readMcpResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}),2);assert.equal(parsed.result.ok,true);
 await assert.rejects(()=>readMcpResponse(Response.json({id:8,result:{}}),2));
});
test('iFinD 真实工具协议：初始化、发现 schema、带日期与令牌查询，密钥不进结果',async()=>{
 process.env.IFIND_API_KEY='test-ifind-context';const calls=[];
 globalThis.fetch=async(url,options)=>{
  assert.match(url,/api-mcp\.51ifind\.com/);assert.equal(options.headers.Authorization,'test-ifind-context');
  const request=JSON.parse(options.body);calls.push(request);
  if(request.method==='notifications/initialized')return new Response(null,{status:202});
  if(request.method==='initialize')return Response.json({id:request.id,result:{protocolVersion:'2024-11-05'}},{headers:{'mcp-session-id':'test-session'}});
  assert.equal(options.headers['Mcp-Session-Id'],'test-session');
  if(request.method==='tools/list')return Response.json({id:request.id,result:{tools:[{name:'search_news',inputSchema:{properties:{query:{type:'string'},size:{type:'number'},time_start:{type:'string'},time_end:{type:'string'}},required:['query','size','time_start','time_end']}}]}});
  assert.equal(request.params.name,'search_news');assert.equal(request.params.arguments.size,5);assert.match(request.params.arguments.time_start,/^\d{4}-\d{2}-\d{2}$/);
  const a={...article,日期:request.params.arguments.time_end};return Response.json({id:request.id,result:{content:[{type:'text',text:envelope([a])}]}});
 };
 const result=await getNewsEvidence();assert.equal(result.status,'ok');assert.equal(result.articles.length,1);assert.equal(JSON.stringify(result).includes('test-ifind-context'),false);assert.equal(calls.length,4);
});
test('新闻缺密钥、鉴权失败不能伪装成没有新闻',async()=>{
 delete process.env.IFIND_API_KEY;assert.equal((await getNewsEvidence()).code,'NOT_CONFIGURED');
 process.env.IFIND_API_KEY='test-denied';globalThis.fetch=async()=>new Response('denied',{status:401});assert.equal((await getNewsEvidence()).code,'AUTH_REQUIRED');
 assert.equal(neededResearch('宁德时代是什么公司？').company,true);assert.equal(neededResearch('有哪些近期新闻？').news,true);
});
