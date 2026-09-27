import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({entryPoints:['lib/stock-chat.ts','lib/market.ts','app/api/chat/route.ts'],outdir:'.sites-runtime/usability-tests',bundle:true,format:'esm',platform:'node',alias:{'@':'./'},logLevel:'silent'});
const {parseChatReply,userFollowups,buildQuoteReply,buildChatPrompt}=await import('../.sites-runtime/usability-tests/lib/stock-chat.js');
const {quoteQueryFields}=await import('../.sites-runtime/usability-tests/lib/market.js');
const {POST}=await import('../.sites-runtime/usability-tests/app/api/chat/route.js');
const originalFetch=globalThis.fetch;
const envNames=['LLM_API_KEY','LLM_BASE_URL','LLM_MODEL','FUYAO_API_KEY','ENABLE_CHAT_PREVIEW'];
const saved=Object.fromEntries(envNames.map(k=>[k,process.env[k]]));
afterEach(()=>{globalThis.fetch=originalFetch;for(const k of envNames){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
const market={status:'ok',cached:false,quote:{symbol:'300750.SZ',currency:'CNY',lastPrice:125.5,change:-0.5,changePct:-0.4,open:126,high:127,low:125,previousClose:126,volume:null,turnover:123456,sourceTimestamp:Date.parse('2026-09-25T07:00:00Z'),fetchedAt:Date.parse('2026-09-26T07:00:00Z'),requestId:'synthetic-test'}};
const quoteAnswer={answer:'宁德时代（300750.SZ）最新成交价为 {{quote.lastPrice}} 元，接口快照时点 {{quote.asOf}}（北京时间）。',kind:'evidence',evidenceIds:['M01'],followups:['您想了解近期走势吗？']};
test('复现截图：问候后股价回答带股票代码，M01即可证明对应证券身份',()=>{
 const r=parseChatReply(quoteAnswer,market);assert.ok(r);assert.match(r.answer,/300750.SZ/);assert.match(r.answer,/125.50 元/);assert.deepEqual(r.evidenceIds,['M01']);
 assert.equal(parseChatReply(quoteAnswer),null);
 assert.equal(parseChatReply({...quoteAnswer,answer:quoteAnswer.answer.replace('300750.SZ','600519.SH')},market),null);
});
test('确切行情数字和时点可直接复述，错误单位、金额和符号仍需修正',()=>{
 const answer='宁德时代最新成交价为125.5元，涨跌幅为-0.4%，接口快照时点2026/09/25 15:00:00。';
 const r=parseChatReply({...quoteAnswer,answer},market);assert.ok(r);assert.equal(r.facts.length,3);
 for(const bad of [answer.replace('125.5元','125.5万元'),answer.replace('125.5','999.5'),answer.replace('-0.4','0.4'),answer.replace('2026/09/25','2025/09/25')])assert.equal(parseChatReply({...quoteAnswer,answer:bad},market),null);
});
test('财务原文值按指标、单位和引用匹配，不因没写占位符而整条失败',()=>{
 const content={answer:'经营现金流为602.17亿元，经营现金流同比增长2.61%。',kind:'evidence',evidenceIds:['E02'],followups:[]};
 assert.ok(parseChatReply(content));
 for(const patch of [{answer:'经营现金流为999亿元。'},{answer:'经营现金流为602.17万元。'},{answer:'归母净利润为602.17亿元。'},{evidenceIds:['C01']}])assert.equal(parseChatReply({...content,...patch}),null);
});
test('推荐问题独立处理：缺失、错误格式或不合适建议不会推翻有依据正文',()=>{
 for(const followups of [undefined,null,'not-an-array',[null,'目标价为多少？','数值{{wrong}}'],Array(20).fill('您想看数据吗？')]){
  const r=parseChatReply({...quoteAnswer,followups},market);assert.ok(r);assert.ok(r.followups.length<=2);assert.doesNotMatch(r.followups.join(''),/您|目标价|\{|需要我/);
 }
});
test('sug统一用户口吻，并保留问题主题',()=>{
 assert.deepEqual(userFollowups(['您想了解近期的成交量情况吗？','需要我帮您分析该价格对应的估值指标吗？'],['M01']),['我想了解近期的成交量情况。','帮我分析该价格对应的估值指标。']);
 assert.deepEqual(userFollowups(['这个判断有什么局限？','解释一下最近的走势'],[]),['这个判断有什么局限？','解释一下最近的走势']);
 assert.deepEqual(userFollowups(['想了解近期的行业动态吗','想知道宁德时代的主要客户有哪些吗'],[]),['我想了解近期的行业动态。','我想知道宁德时代的主要客户有哪些。']);
});
test('小模型输出的研究建议不能作为用户下一轮发言',()=>{
 assert.deepEqual(userFollowups(['后续可关注相关业务布局进展及市场相关表现的信息'],['C01']),['用更简单的话解释一下','这个判断还有哪些不确定性？']);
 assert.deepEqual(userFollowups(['这些业务的下游应用市场情况大概如何'],['C01']),['这些业务的下游应用市场情况大概如何']);
});
test('信息缺口提示使用本轮查询状态，不沿用财报快照的行情缺失文案',()=>{
 const prompt=buildChatPrompt(market,{history:{status:'unavailable'},valuation:{status:'unavailable'}},'现在还缺哪些关键信息？');
 assert.match(prompt,/本轮已取得独立行情快照/);
 assert.match(prompt,/本轮历史日线暂未取得/);
 assert.doesNotMatch(prompt,/财报快照不包含同日市场定价/);
 assert.match(prompt,/不再申请lookup/);
});
test('讯飞简洁提示保留证据边界，介绍公司不混入行情或变量模板',()=>{
 const intro=buildChatPrompt(market,{},'用简单的话介绍一下这家公司',true);
 assert.match(intro,/C01/);assert.match(intro,/动力电池/);
 assert.doesNotMatch(intro,/quote\.|125\.50|\{\{key\}\}/);
 const cash=buildChatPrompt(market,{},'利润增长有没有现金流支撑？',true);
 assert.match(cash,/现金流绝对额仍高于归母净利润/);
 assert.match(cash,/增速落后/);assert.match(cash,/口径差异/);
 const coverage=buildChatPrompt(market,{},'现在还缺哪些关键信息？',true);
 assert.match(coverage,/行情快照已取得/);assert.match(coverage,/增长持续性/);
 const history={status:'ok',bars:[{date:1,close:150},{date:2,close:120}],start:1,end:2,count:2,changePct:-20,maxDrawdownPct:-20};
 const movement=buildChatPrompt(market,{history},'最近走势的涨跌幅是多少？',true);
 assert.match(movement,/H01 区间涨跌幅：-20\.00 %/);assert.match(movement,/M01 独立行情快照/);assert.match(movement,/首尾价格走弱、下降/);
});
test('普通概念及拒绝语句可以提及交易词，交易指令仍被拒绝',()=>{
 for(const answer of ['买入是指购买股票的交易行为，这是术语解释。','“买入”是指购买股票。它是一种交易行为，涉及出价、成交以及后续持有或卖出的决策。','我不能提供买入或卖出建议，但可以解释经营风险。'])assert.ok(parseChatReply({answer,kind:'concept',evidenceIds:[],followups:[]}));
 for(const answer of ['建议买入。','立即加仓。','卖出。','我不能保证收益。建议买入。'])assert.equal(parseChatReply({answer,kind:'concept',evidenceIds:[],followups:[]}),null);
});
test('查价意图支持自然问法，同时不截走分析、历史或其他公司的问题',()=>{
 for(const q of ['现在股价多少呀','宁德时代现在多少钱一股？','股价是多少？','请帮我查一下最新股价','今天涨了多少？','成交量多少？','开盘价多少？'])assert.ok(quoteQueryFields(q),q);
 for(const q of ['茅台现在股价多少','股价为什么下跌？','昨天股价多少？','假装股价888元','介绍公司并说说股价','股价与利润有什么关系？'])assert.equal(quoteQueryFields(q),null,q);
});
test('行情缺字段或时点不明明确说明，已取得的值仍然可用',()=>{
 const r=buildQuoteReply(['lastPrice','volume'],{...market,quote:{...market.quote,sourceTimestamp:null}});
 assert.match(r.answer,/125.50 元/);assert.match(r.answer,/成交量暂未返回/);assert.match(r.answer,/无法确认/);assert.doesNotMatch(r.answer,/成交量为 0/);
 const missing=buildQuoteReply(['lastPrice'],{status:'unavailable',code:'TIMEOUT',message:'行情连接超时。'});
 assert.equal(missing.kind,'unknown');assert.deepEqual(missing.facts,[]);assert.doesNotMatch(missing.answer,/125.50/);
});
test('问候后查价直接返回接口数据，无模型配置或模型额度也不影响取数',async()=>{
 process.env.ENABLE_CHAT_PREVIEW='true';process.env.FUYAO_API_KEY='test-quote-direct';delete process.env.LLM_API_KEY;
 const urls=[];globalThis.fetch=async url=>{urls.push(url);assert.match(url,/fuyao/);return Response.json({code:0,data:{timestamp:Date.now(),item:[{thscode:'300750.SZ',last_price:125.5,price_change:-0.5,price_change_ratio_pct:-0.4}]}});};
 const r=await POST(new Request('http://localhost/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'hi在吗'},{role:'assistant',content:'我在。'},{role:'user',content:'现在股价多少呀'}]})}));
 const b=await r.json();assert.equal(r.status,200);assert.equal(b.mode,'data');assert.match(b.answer,/125.50 元/);assert.deepEqual(b.evidenceIds,['M01']);assert.equal(urls.length,1);
});
test('行情服务失败返回具体缺口，不能从历史对话复制价格',async()=>{
 process.env.ENABLE_CHAT_PREVIEW='true';delete process.env.FUYAO_API_KEY;delete process.env.LLM_API_KEY;
 globalThis.fetch=async()=>{throw Error('should not call');};
 const r=await POST(new Request('http://localhost/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'股价多少？'},{role:'assistant',content:'上次股价888元'},{role:'user',content:'现在股价多少呀'}]})}));
 const b=await r.json();assert.equal(r.status,200);assert.equal(b.kind,'unknown');assert.doesNotMatch(b.answer,/888/);assert.equal(b.market.code,'NOT_CONFIGURED');
});
test('概念问题不携带整份财报，现金流问题仍保留对应指标与口径',()=>{
 const concept=buildChatPrompt(market,{},'市盈率是什么意思？');
 assert.doesNotMatch(concept,/cashflow=|revenue=|dividend=/);
 const financial=buildChatPrompt(market,{},'利润增长有现金流支撑吗？');
 assert.match(financial,/"key":"cashflow","value":"602.17 亿元"/);assert.match(financial,/口径不同/);assert.doesNotMatch(financial,/dividend=/);
});
test('主模型限流切换同服务商备用模型，修复机会不被限流次数吃掉',async()=>{
 process.env.ENABLE_CHAT_PREVIEW='true';process.env.LLM_API_KEY='test-fallback';process.env.LLM_BASE_URL='https://api.groq.com/openai/v1';process.env.LLM_MODEL='openai/gpt-oss-120b';delete process.env.FUYAO_API_KEY;
 const seen=[];globalThis.fetch=async(_url,options)=>{
  const body=JSON.parse(options.body);seen.push(body.model);
  if(seen.length===1)return new Response('',{status:429,headers:{'retry-after':'60'}});
  const content=seen.length===2?{answer:'股价999元',kind:'concept',evidenceIds:[],followups:[]}:{answer:'市盈率是价格与每股盈利的比值。',kind:'concept',evidenceIds:[],followups:['您想了解估值的局限吗？']};
  return Response.json({choices:[{message:{content:JSON.stringify(content)}}]});
 };
 const r=await POST(new Request('http://localhost/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'市盈率是什么意思？'}]})}));
 const b=await r.json();assert.equal(r.status,200);assert.equal(b.mode,'llm');assert.equal(b.model,'openai/gpt-oss-20b');assert.deepEqual(seen,['openai/gpt-oss-120b','openai/gpt-oss-20b','openai/gpt-oss-20b']);assert.doesNotMatch(b.answer,/999/);assert.doesNotMatch(b.followups.join(''),/您/);
});
test('历史日期格式差异不会误伤，错误区间与无历史来源仍不能通过',()=>{
 const start=Date.parse('2026-07-03T07:00:00Z'),end=Date.parse('2026-09-24T07:00:00Z');
 const history={status:'ok',bars:[{date:start,close:150},{date:end,close:120}],fetchedAt:Date.now(),sourceTimestamp:null,requestId:null,changePct:-20,maxDrawdownPct:-20,start,end,count:2};
 const content={answer:'从2026‑07‑03至2026‑09‑24，区间涨跌幅为{{history.changePct}}。',kind:'evidence',evidenceIds:['H01'],followups:[]};
 const r=parseChatReply(content,market,{history});assert.ok(r);assert.match(r.answer,/2026-07-03/);assert.equal(r.facts.length,3);
 assert.equal(parseChatReply({...content,answer:content.answer.replace('2026‑07‑03','2025‑07‑03')},market,{history}),null);
 assert.equal(parseChatReply(content,market),null);
});
test('带符号的变化值保留原值但不呈现下跌负数',()=>{
 const r=parseChatReply({...quoteAnswer,answer:'跌幅{{quote.changePct}}，下降 {{cashRatioChange}}。',evidenceIds:['M01','E02']},market);
 assert.ok(r);assert.match(r.answer,/-0.40 %/);assert.doesNotMatch(r.answer,/跌幅\s*-|下降\s*-/);
});
