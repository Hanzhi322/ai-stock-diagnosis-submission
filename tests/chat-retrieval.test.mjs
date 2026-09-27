import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/ifind-research.ts','lib/chat-answer.ts','lib/stock-chat.ts','app/api/chat/route.ts','lib/ifind-research-server.ts'],outdir:'.sites-runtime/retrieval-tests',bundle:true,format:'esm',platform:'node',alias:{'@':'./'},logLevel:'silent'});
const {planResearch,researchLookup,parseResearchTool,snapshotConflict}=await import('../.sites-runtime/retrieval-tests/lib/ifind-research.js');
const {inspectChatAnswer}=await import('../.sites-runtime/retrieval-tests/lib/chat-answer.js');
const {buildChatPrompt,parseChatReply}=await import('../.sites-runtime/retrieval-tests/lib/stock-chat.js');
const {POST}=await import('../.sites-runtime/retrieval-tests/app/api/chat/route.js');
const {getIfindResearch}=await import('../.sites-runtime/retrieval-tests/lib/ifind-research-server.js');
const savedFetch=globalThis.fetch;
const envNames=['LLM_API_KEY','LLM_BASE_URL','LLM_MODEL','ENABLE_CHAT_PREVIEW','IFIND_API_KEY','IFIND_TRANSPORT','FUYAO_API_KEY'];
const saved=Object.fromEntries(envNames.map(k=>[k,process.env[k]]));
afterEach(()=>{globalThis.fetch=savedFetch;for(const k of envNames){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
const unavailable={status:'unavailable',code:'TIMEOUT',message:'本次查询暂未完成。'};
const answer=(text,ids=['E02'],kind='evidence')=>({answer:text,kind,evidenceIds:ids,followups:[]});
const request=q=>new Request('http://localhost/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:q}]})});
const modelReply=v=>Response.json({choices:[{message:{content:JSON.stringify(v)}}]});
function configure(key){process.env.ENABLE_CHAT_PREVIEW='true';process.env.LLM_API_KEY='test-llm';process.env.LLM_BASE_URL='https://api.groq.com/openai/v1';process.env.IFIND_API_KEY=key;process.env.IFIND_TRANSPORT='fetch';delete process.env.FUYAO_API_KEY;}
const toolNames=['get_stock_summary','get_security_indicators','search_notice','search_news'];
const tools=toolNames.map(name=>({name,inputSchema:{required:name.startsWith('search_')?['query','size','time_start','time_end']:name==='get_security_indicators'?['query','market']:['query']}}));
function rpcResponse(body){return Response.json({jsonrpc:'2.0',id:body.id,result:body.method==='initialize'?{serverInfo:{name:'synthetic'}}:body.method==='tools/list'?{tools}:body.method==='tools/call'?{content:[{type:'text',text:JSON.stringify({code:1,msg:'success',data:body.params.name==='search_notice'?JSON.stringify([{'公告标题':'宁德时代业务公告','公告片段内容':'报告说明：正在推进海外产能建设，实际投产仍应关注后续公告。','日期':new Date().toISOString().slice(0,10)}]):{answer:'宁德时代主要从事动力电池和储能电池业务。'}})}]}:{}});}

test('截图问题会查询财务和公告，并把已有全部财报证据交给模型',()=>{
 assert.deepEqual(planResearch('现在还缺哪些关键信息？').map(x=>x.tool),['get_security_indicators','search_notice']);
 const prompt=buildChatPrompt(unavailable,{},'现在还缺哪些关键信息？');
 for(const id of ['E01','E02','E03','E05','E06','E07'])assert.match(prompt,new RegExp(id));
 assert.match(prompt,/不能说缺失/);
 assert.deepEqual(planResearch('hi在吗'),[]);
 assert.deepEqual(planResearch('市盈率是什么意思？'),[]);
});
test('检索主题随问题变化，公告窗口覆盖历史，新闻不再固定泛搜',()=>{
 const a=planResearch('最近匈牙利工厂有哪些新闻？');
 assert.equal(a[0].tool,'search_news');assert.match(a[0].query,/匈牙利/);
 assert.notEqual(a[0].query,planResearch('最近分红有什么新闻？')[0].query);
 const n=researchLookup('search_notice','宁德时代2025年分红实施',Date.parse('2026-09-26T12:00:00Z'));
 assert.equal(n.time_start,'2025-01-01');assert.equal(n.time_end,'2026-09-26');
});
test('真实响应形状：财务表头元但单元格亿，保留单元格倍率和期次',()=>{
 const parsed=parseResearchTool('get_security_indicators',{code:1,msg:'success',data:{answer:'|证券代码|证券简称|营业收入（单位：元）|经营活动产生的现金流量净额（单位：元）|\n|---|---|---|---|\n|300750.SZ|宁德时代|123.456亿|5.123亿|',indicators_params:{营业收入:{报告期:'2025年年度'}}}},researchLookup('get_security_indicators','合成测试'));
 assert.equal(parsed.facts['research.F01.n2'].value,'123.456 亿元');
 assert.equal(parsed.facts['research.F01.n2'].period,'2025年年度');
 assert.match(parsed.sources[0].timing,/2025年年度/);
});
test('公告工具的嵌套JSON、原文缺链和同期间数量级冲突分别保留',()=>{
 const lookup=researchLookup('search_notice','半年报');
 const raw={code:1,msg:'success',data:JSON.stringify([{'公告标题':'宁德时代：2026年半年度报告','公告片段内容':'营业收入：276.92亿元。','日期':'2026-07-25'},{'备注':'非数据'}])};
 const r=parseResearchTool('search_notice',raw,lookup);
 assert.equal(r.sources.length,1);assert.equal(r.sources[0].conflict,true);assert.match(r.sources[0].warnings.join(''),/原文链接/);
 assert.equal(snapshotConflict('2025年半年度报告','营业收入276.92亿元。'),false);
 assert.equal(snapshotConflict('2026年半年度报告','营业收入2769.17亿元。'),false);
});
test('合法括号编号和待研究报告不再整段失败，任意金融数字仍不能放行',()=>{
 for(const text of ['(1) 经营现金流仍为正。\n（2）增速值得交叉核验。','还需核对2026年三季报和同行估值。'])assert.ok(inspectChatAnswer(answer(text)).reply);
 assert.equal(inspectChatAnswer(answer('经营现金流为999999亿元。')).reply,null);
});
test('真实模型的双重转义换行先恢复，列表编号不会当成金融数字',()=>{
 const r=inspectChatAnswer(answer('已有2026上半年财务资料。\\n\\n1. 后续关注订单能否兑现。\\n2. 还需比较同行估值。',[],'concept'));
 assert.ok(r.reply);assert.equal(r.issues.length,0);assert.doesNotMatch(r.reply.answer,/\\n/);assert.match(r.reply.answer,/• 后续关注/);
});
test('一个冲突来源不误伤独立的已核实财报段落',()=>{
 const context={research:{status:'ok',sources:[{id:'A01',title:'合成公告',text:'片段冲突',url:'https://example.com',conflict:true,category:'notice',warnings:[]}],facts:{},queries:[],fetchedAt:Date.now()}};
 const r=inspectChatAnswer(answer('经营现金流为{{cashflow}}。\nA01 的金额还需要复核。',['E02','A01']),undefined,context);
 assert.ok(r.reply);assert.equal(r.issues.length,0);assert.match(r.reply.answer,/602.17/);
});
test('现金流增加额不与现金流净额混比较，识别失败不算成功数据',()=>{
 assert.equal(snapshotConflict('宁德时代2026年中期报告','经营活动产生的现金流量净额较上年增加人民币15亿元，上升2.61%。'),false);
 assert.throws(()=>parseResearchTool('get_stock_summary',{code:1,msg:'success',data:'未能识别到有效的A股股票主体'},researchLookup('get_stock_summary','介绍公司')),/NO_RESULTS/);
 assert.equal(researchLookup('get_stock_summary','介绍公司').query,'宁德时代主营业务');
});
test('财务实际返回日期优先于MRQ标签，未来日期不给模型数值',()=>{
 const financial=date=>({code:1,msg:'success',data:{answer:`|证券代码|证券简称|日期|营业收入（单位：元）|\n|---|---|---|---|\n|300750.SZ|宁德时代|${date}|123亿|`,indicators_params:{营业收入:{报告期:'最新一期(MRQ)'}}}});
 const lookup=researchLookup('get_security_indicators','最新财报');
 const old=parseResearchTool('get_security_indicators',financial('20230930'),lookup,Date.parse('2026-09-26T00:00:00Z'));
 assert.match(old.sources[0].warnings.join(''),/早于已有财报/);assert.match(old.facts['research.F01.n3'].period,/2023-09-30/);
 const future=parseResearchTool('get_security_indicators',financial('20260930'),lookup,Date.parse('2026-09-26T00:00:00Z'));
 assert.equal(future.sources[0].conflict,true);assert.deepEqual(future.facts,{});
});
test('新闻日期及数量可追溯；HTTP原文链接保留，缺链不伪造',()=>{
 const parsed=parseResearchTool('search_news',{code:1,msg:'success',data:{data:JSON.stringify([{'资讯标题':'合成工厂报道','资讯内容':'报道计划产能为100GWh，实际进展仍需确认。','日期':'2026-09-22',URL:'http://news.10jqka.com.cn/example.shtml'}])}},researchLookup('search_news','工厂新闻',Date.parse('2026-09-26T00:00:00Z')));
 assert.equal(parsed.sources[0].url,'http://news.10jqka.com.cn/example.shtml');
 const context={research:{...parsed,status:'ok',queries:[],fetchedAt:Date.now()}};
 assert.ok(inspectChatAnswer(answer('2026-09-22 的报道提及规划产能100GWh。',['N01']),undefined,context).reply);
 assert.equal(inspectChatAnswer(answer('2026-09-22 的报道提及规划产能999GWh。',['N01']),undefined,context).reply,null);
});
test('公告同比增加额不能被当成当期总額，其他回答段落保留',()=>{
 const parsed=parseResearchTool('search_notice',{code:1,msg:'success',data:JSON.stringify([{'公告标题':'合成现金流公告','公告片段内容':'投资活动净流出较上年增加107亿元。','日期':'2026-09-22'}])},researchLookup('search_notice','现金流'));
 const context={research:{...parsed,status:'ok',queries:[],fetchedAt:Date.now()}};
 assert.equal(inspectChatAnswer(answer('投资活动净流出为107亿元。',['A01']),undefined,context).reply,null);
 assert.ok(inspectChatAnswer(answer('投资活动净流出较上年增加107亿元。',['A01']),undefined,context).reply);
});
test('新闻中的中文日期可正常引用，不把事件日期和发表日期混为一谈',()=>{
 const parsed=parseResearchTool('search_news',{code:1,msg:'success',data:JSON.stringify([{'资讯标题':'合成工厂报道','资讯内容':'9月22日开始试生产，项目于2026年8月取得使用许可。','日期':'2026-09-24'}])},researchLookup('search_news','工厂新闻',Date.parse('2026-09-26T00:00:00Z')));
 const context={research:{...parsed,status:'ok',queries:[],fetchedAt:Date.now()}};
 const reply=inspectChatAnswer(answer('2026年9月24日的报道提及，工厂2026年9月22日启动试产，此前于2026年8月取得使用许可。',['N01']),undefined,context).reply;
 assert.ok(reply);assert.match(reply.answer,/9月22日/);assert.equal(reply.facts.length,3);
});
test('局部失败保留独立有效段落，同时去掉依赖失败前提的结论',()=>{
 const v={blocks:[{text:'经营现金流为 {{cashflow}}。',kind:'evidence',evidenceIds:['E02']},{text:'股价999元。',kind:'evidence',evidenceIds:['E04']},{text:'因此市场已经认可增长。',kind:'evidence',evidenceIds:['E04']}],followups:['现金流变化说明什么？']};
 const r=inspectChatAnswer(v).reply;assert.ok(r);assert.match(r.answer,/602.17/);assert.doesNotMatch(r.answer,/999|市场已经认可/);assert.equal(r.partial,true);assert.doesNotMatch(r.notice,/校验|修复/);
});
test('即使模型没分段，也仅去掉无依据的一句及依赖它的结论',()=>{
 const r=inspectChatAnswer(answer('经营现金流为{{cashflow}}。股价为999999元。因此市场已经认可增长。后续仍应核对回款情况。')).reply;
 assert.ok(r);assert.match(r.answer,/602.17/);assert.match(r.answer,/后续仍应核对/);assert.doesNotMatch(r.answer,/999999|认可增长/);assert.equal(r.partial,true);
});
test('行情引用不能替代财务或量能证据，其余走势描述继续保留',()=>{
 const context={history:{status:'ok',bars:[{date:Date.parse('2026-07-03'),close:150},{date:Date.parse('2026-09-24'),close:120}],start:Date.parse('2026-07-03'),end:Date.parse('2026-09-24'),count:2,changePct:-20,maxDrawdownPct:-20,fetchedAt:Date.now(),sourceTimestamp:null,requestId:null}};
 const r=inspectChatAnswer(answer('区间股价走弱。成交量保持活跃。毛利率下降与原材料成本上升相关。股价在宏观市场波动和行业景气度下降的背景下持续走低。',['H01']),undefined,context).reply;
 assert.ok(r);assert.equal(r.answer,'区间股价走弱。');assert.equal(r.partial,true);
});
test('后续提问保留紧邻一轮，较早模型回答不能充当新一轮事实源',async()=>{
 configure('test-window');delete process.env.IFIND_API_KEY;
 globalThis.fetch=async(_url,options)=>{const b=JSON.parse(options.body);assert.equal(b.messages.length,4);assert.equal(b.messages.some(m=>m.content.includes('这是一段过期分析')),false);return modelReply(answer('可以继续核对。',[],'concept'));};
 const r=await POST(new Request('http://localhost/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'较早的问题'},{role:'assistant',content:'这是一段过期分析'},{role:'user',content:'你好'},{role:'assistant',content:'你好，我在。'},{role:'user',content:'谢谢'}]})}));
 assert.equal(r.status,200);
});
test('已有财报不再被描述成全无资料，相关错误会交给模型针对性重写',()=>{
 const r=inspectChatAnswer(answer('目前缺乏利润、现金流和毛利率数据。',[],'unknown'));
 assert.equal(r.reply,null);assert.match(r.issues.join(''),/已有半年报/);
});
test('可自动补全正文里的真实引用，未知来源不会伪装成证据',()=>{
 assert.ok(inspectChatAnswer(answer('E02 显示经营现金流仍为正。',[])).reply);
 assert.equal(inspectChatAnswer(answer('E99 显示经营良好。',[])).reply,null);
 assert.ok(inspectChatAnswer(answer('经营现金流为{{cashflow}}。',['E02','E99'])).reply);
});
test('综合回答允许超过八个已知引用，引用数量不构成内容错误',()=>{
 const ids=['E01','E02','E03','E04','E05','E06','E07','C01'];
 const context={research:{status:'ok',sources:[{id:'A01',title:'合成公告',text:'经营信息',url:'https://example.com',warnings:[],conflict:false,category:'notice'}],facts:{},queries:[],fetchedAt:Date.now()}};
 assert.ok(parseChatReply(answer('已有多个角度的证据可供交叉研究。',[...ids,'A01']),undefined,context));
});
test('综合MCP实际执行初始化、工具发现与查询；相同问题合并并缓存',async()=>{
 configure('test-research-cache');const calls=[];
 globalThis.fetch=async(url,options)=>{assert.match(url,/hexin-ifind-ds-mcp$/);const b=JSON.parse(options.body);calls.push(b);return rpcResponse(b);};
 const [a,b]=await Promise.all([getIfindResearch('用简单的话介绍一下这家公司'),getIfindResearch('用简单的话介绍一下这家公司')]);
 assert.equal(a.status,'ok');assert.deepEqual(a,b);assert.ok(a.sources.some(s=>s.id==='B01'));
 assert.equal(calls.filter(x=>x.method==='tools/call').length,1);
 await getIfindResearch('用简单的话介绍一下这家公司');assert.equal(calls.filter(x=>x.method==='tools/call').length,1);
 assert.equal(JSON.stringify(a).includes('test-research-cache'),false);
});
test('模型可发起一次针对性补查，并将公告结果用于最终回答',async()=>{
 configure('test-model-lookup');let modelCalls=0;const toolCalls=[];
 globalThis.fetch=async(url,options)=>{
  const b=JSON.parse(options.body);
  if(String(url).includes('api-mcp')){if(b.method==='tools/call')toolCalls.push(b.params);return rpcResponse(b);}
  modelCalls++;
  if(modelCalls===1)return modelReply({lookup:{tool:'search_notice',query:'宁德时代海外扩产最新公告'}});
  assert.match(b.messages[0].content,/A01/);assert.match(b.messages[0].content,/不能再次申请/);
  return modelReply(answer('公告片段说明公司正在推进海外产能建设，实际投产仍需关注后续披露。',['A01']));
 };
 const r=await POST(request('公司海外布局怎样？'));const body=await r.json();
 assert.equal(r.status,200);assert.equal(body.mode,'llm');assert.ok(toolCalls.some(t=>t.name==='search_notice'&&t.arguments.query.includes('海外扩产')));assert.equal(modelCalls,2);assert.ok(body.sources.some(s=>s.id==='A01'));
});
test('局部有效回答直接返回，不因一段无依据数字额外耗用模型额度',async()=>{
 configure('test-partial-route');let count=0;
 globalThis.fetch=async(url,options)=>{if(String(url).includes('api-mcp'))return rpcResponse(JSON.parse(options.body));count++;return modelReply(answer('经营现金流为{{cashflow}}。\n股价为99999元。'));};
 const r=await POST(request('利润与现金流怎样？'));const body=await r.json();assert.equal(r.status,200);assert.equal(count,1);assert.equal(body.partial,true);assert.doesNotMatch(body.answer,/99999/);
});
test('补查失败仍可回答已有证据，不把工具失败说成公司没有公告',async()=>{
 configure('test-tool-failure');let n=0;
 globalThis.fetch=async(url)=>{if(String(url).includes('api-mcp'))return new Response('',{status:503});n++;return modelReply(answer('经营现金流仍为正，但增速与利润并不一致。'));};
 const r=await POST(request('利润有现金流支撑吗？'));const body=await r.json();assert.equal(r.status,200);assert.equal(body.mode,'llm');assert.doesNotMatch(body.answer,/没有公告|修复失败/);assert.equal(n,1);
});
test('截图问题模型无有效正文时仍提供明确标记的已有事实整理',async()=>{
 configure('test-coverage-fallback');globalThis.fetch=async(url,options)=>String(url).includes('api-mcp')?rpcResponse(JSON.parse(options.body)):modelReply(answer('经营现金流999999亿元。'));
 const r=await POST(request('现在还缺哪些关键信息？'));const body=await r.json();assert.equal(r.status,200);assert.equal(body.mode,'data');assert.match(body.answer,/已核对半年报/);assert.match(body.notice,/AI 解读暂未完成/);assert.doesNotMatch(body.answer,/999999|修复失败/);
});
test('Groq格式400中的可用正文同样接受逐段检查，而非直接报服务失败',async()=>{
 configure('test-provider-json');
 globalThis.fetch=async(url,options)=>String(url).includes('api-mcp')?rpcResponse(JSON.parse(options.body)):Response.json({error:{code:'json_validate_failed',failed_generation:JSON.stringify({blocks:[{text:'市盈率是价格与盈利的比值。',kind:'concept',evidenceIds:[]},'followups',':',[]]})}},{status:400});
 const r=await POST(request('市盈率是什么意思？'));const body=await r.json();
 assert.equal(r.status,200);assert.equal(body.mode,'llm');assert.match(body.answer,/价格与盈利/);assert.doesNotMatch(body.answer,/failed|校验/);
});
