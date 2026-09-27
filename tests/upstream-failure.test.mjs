import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

await build({entryPoints:['lib/upstream-failure.ts','lib/ifind-server.ts','app/api/chat/route.ts'],outdir:'.sites-runtime/upstream-failure-tests',bundle:true,format:'esm',platform:'node',alias:{'@':'./'},logLevel:'silent'});
const {classifyUpstreamFailure,redactUpstreamError,logUpstreamFailure,readUpstreamError}=await import('../.sites-runtime/upstream-failure-tests/lib/upstream-failure.js');
const {getNewsEvidence}=await import('../.sites-runtime/upstream-failure-tests/lib/ifind-server.js');
const {POST}=await import('../.sites-runtime/upstream-failure-tests/app/api/chat/route.js');

test('403 不再被擅自归因为无效密钥或地域封禁',()=>{
 assert.equal(classifyUpstreamFailure(401,'denied').reason,'authentication');
 assert.equal(classifyUpstreamFailure(403,'Access denied').reason,'access_denied');
 assert.equal(classifyUpstreamFailure(403,{error:{code:'unsupported_country_region_territory'}}).reason,'region_restricted');
 assert.equal(classifyUpstreamFailure(403,{error:{code:'model_permission_blocked'}}).reason,'model_permission');
 assert.equal(classifyUpstreamFailure(429,'limit').reason,'rate_limit');
});

test('服务器排障日志脱敏，外部只返回状态和分类',()=>{
 const secret='test-opaque-credential-without-prefix';
 assert.equal(redactUpstreamError(`invalid ${secret} Bearer abc123 https://x.test?token=anything`,[secret]),'invalid [redacted] Bearer [redacted] https://x.test?token=[redacted]');
 assert.ok(!redactUpstreamError(JSON.stringify({error:`Invalid token: ${secret}`}),[`"${secret}"`]).includes(secret));
 const old=process.env.IFIND_API_KEY,warn=console.warn,logs=[];
 try {
  process.env.IFIND_API_KEY=secret;console.warn=(...args)=>logs.push(args);
  const result=logUpstreamFailure('ifind-news','initialize',403,{error:`denied ${secret}`});
  assert.deepEqual(result,{status:403,reason:'access_denied'});
  assert.ok(!JSON.stringify(logs).includes(secret));assert.match(JSON.stringify(logs),/redacted/);
 } finally {console.warn=warn;if(old===undefined)delete process.env.IFIND_API_KEY;else process.env.IFIND_API_KEY=old;}
});

test('读取上游错误有大小限制，纯文本错误也能保留供排障',async()=>{
 assert.deepEqual(await readUpstreamError(Response.json({error:{code:'invalid_api_key'}})),{error:{code:'invalid_api_key'}});
 assert.equal(await readUpstreamError(new Response('Access denied')),'Access denied');
 assert.equal((await readUpstreamError(new Response('x'.repeat(20000)))).length,8192);
});

test('新闻 401 与 403 分开；对话保留 403 状态但不暴露原始错误',async()=>{
 const names=['IFIND_API_KEY','LLM_API_KEY','ENABLE_CHAT_PREVIEW','FUYAO_API_KEY','LLM_BASE_URL'];
 const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const fetch=globalThis.fetch,warn=console.warn;
 try {
  console.warn=()=>{};
  process.env.IFIND_API_KEY='news-401';globalThis.fetch=async()=>new Response('unauthorized',{status:401});
  assert.equal((await getNewsEvidence()).code,'AUTH_REQUIRED');
  process.env.IFIND_API_KEY='news-403';globalThis.fetch=async()=>new Response('Access denied',{status:403});
  const news=await getNewsEvidence();assert.equal(news.code,'FORBIDDEN');assert.doesNotMatch(news.message,/认证失败|令牌无效/);
  delete process.env.IFIND_API_KEY;delete process.env.FUYAO_API_KEY;
  process.env.LLM_API_KEY='test-model-credential';process.env.ENABLE_CHAT_PREVIEW='true';process.env.LLM_BASE_URL='https://api.groq.com/openai/v1';
  globalThis.fetch=async()=>Response.json({error:{message:'Access denied test-model-credential'}},{status:403});
  const response=await POST(new Request('https://app.test/api/chat',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'你好'}]})}));
  const result=await response.json();assert.equal(response.status,502);assert.equal(result.code,'UPSTREAM_403');assert.equal(result.answer,undefined);
  assert.doesNotMatch(JSON.stringify(result),/test-model-credential|Access denied/);
 } finally {globalThis.fetch=fetch;console.warn=warn;for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}}
});
