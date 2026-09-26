import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

await build({ entryPoints: ['lib/market-server.ts', 'lib/market.ts', 'lib/stock-chat.ts', 'app/api/chat/route.ts', 'app/api/quote/route.ts'],
  outdir: '.sites-runtime/market-tests', bundle: true, format: 'esm', platform: 'node', alias: { '@': './' }, logLevel: 'silent' });
const { parseMarketPayload, getMarketQuote } = await import('../.sites-runtime/market-tests/lib/market-server.js');
const { quoteFreshness, quoteTime } = await import('../.sites-runtime/market-tests/lib/market.js');
const { parseChatReply, buildChatPrompt } = await import('../.sites-runtime/market-tests/lib/stock-chat.js');
const { POST } = await import('../.sites-runtime/market-tests/app/api/chat/route.js');
const { GET } = await import('../.sites-runtime/market-tests/app/api/quote/route.js');
const originalFetch = globalThis.fetch;
const names = ['FUYAO_API_KEY', 'LLM_API_KEY', 'ENABLE_CHAT_PREVIEW', 'LLM_BASE_URL'];
const saved = Object.fromEntries(names.map(key => [key, process.env[key]]));
afterEach(() => { globalThis.fetch = originalFetch; for (const key of names) {
  if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
} });
// Synthetic fixtures for contract tests only; never served by the product.
const fixture = () => ({ code: 0, request_id: 'test-trace', data: { timestamp: Date.now() - 1000, item: [{
  thscode: '300750.SZ', last_price: 125.5, prev_price: 125, price_change: 0.5, price_change_ratio_pct: 0.4,
  open_price: 125, high_price: 126, low_price: 124, volume: 2000000, turnover: 251000000,
}] } });

test('行情契约保留价格、百分比原值、股数及数据时间', () => {
  const payload = fixture(); const result = parseMarketPayload(payload);
  assert.equal(result.status, 'ok'); assert.equal(result.quote.lastPrice, 125.5);
  assert.equal(result.quote.changePct, 0.4); assert.equal(result.quote.volume, 2000000);
  assert.equal(result.quote.turnover, 251000000); assert.equal(result.quote.sourceTimestamp, payload.data.timestamp);
  assert.equal(result.quote.currency, 'CNY');
});
test('HTTP 成功中的业务错误仍不能显示正常价格', () => {
  for (const [code, expected] of [[2001, 'AUTH_REQUIRED'], [2003, 'FORBIDDEN'], [4001, 'RATE_LIMIT'], [3002, 'NO_DATA'], [5002, 'PROVIDER_ERROR']]) {
    const result = parseMarketPayload({ code, message: 'do not forward this', data: null });
    assert.equal(result.status, 'unavailable'); assert.equal(result.code, expected); assert.equal(result.quote, undefined);
    assert.ok(!JSON.stringify(result).includes('do not forward'));
  }
});
test('缺失、错误标的、异常数值和未来时间不会变成价格', () => {
  for (const mutate of [p => { p.data.item = []; }, p => { p.data.item[0].thscode = '600519.SH'; },
    p => { p.data.item[0].last_price = null; }, p => { p.data.item[0].last_price = '125.5'; },
    p => { p.data.item[0].last_price = NaN; }, p => { p.data.timestamp = Date.now() + 3600000; },
    p => { p.data.timestamp = 1716105600; }, p => { p.data.item[0].high_price = 120; }]) {
    const payload = fixture(); mutate(payload); assert.equal(parseMarketPayload(payload).status, 'unavailable');
  }
  const payload = fixture(); payload.data.timestamp = null; payload.data.item[0].volume = null;
  const result = parseMarketPayload(payload); assert.equal(result.status, 'ok'); assert.equal(result.quote.volume, null);
  assert.equal(quoteFreshness(result.quote), 'unknown');
});
test('行情时点独立于获取时间，旧快照不标成当前报价', () => {
  const payload = fixture(); payload.data.timestamp = Date.parse('2026-09-25T07:00:00Z');
  const result = parseMarketPayload(payload, Date.parse('2026-09-26T07:00:00Z'));
  assert.equal(quoteFreshness(result.quote, result.quote.fetchedAt), 'older');
  assert.match(quoteTime(payload.data.timestamp), /15:00:00/);
  assert.match(buildChatPrompt(result), /不是成交时点/); assert.match(buildChatPrompt(result), /旧行情/);
});
test('服务端鉴权、并发合并和短时缓存避免重复请求', async () => {
  process.env.FUYAO_API_KEY = 'test-fuyao-cache'; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://fuyao.aicubes.cn/api/a-share/prices/snapshot?thscodes=300750.SZ');
    assert.equal(options.headers['X-api-key'], 'test-fuyao-cache'); return Response.json(fixture());
  };
  const [a, b] = await Promise.all([getMarketQuote(), getMarketQuote()]);
  assert.equal(a.status, 'ok'); assert.equal(b.status, 'ok'); assert.equal(calls, 1);
  const cached = await getMarketQuote(); assert.equal(cached.cached, true); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(cached).includes('test-fuyao-cache'));
});
test('缺少密钥不调用上游，限流后等待而不是连续重试', async () => {
  delete process.env.FUYAO_API_KEY; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '45' } }); };
  assert.equal((await getMarketQuote()).code, 'NOT_CONFIGURED'); assert.equal(calls, 0);
  process.env.FUYAO_API_KEY = 'test-fuyao-rate';
  assert.equal((await getMarketQuote()).retryAfterSeconds, 45);
  assert.equal((await getMarketQuote()).code, 'RATE_LIMIT'); assert.equal(calls, 1);
});
test('对话只能引用本轮成功查询的行情值，缺失与失败不复用旧价', () => {
  const market = parseMarketPayload(fixture());
  const answer = { answer: '截至 {{quote.asOf}}，最新成交价 {{quote.lastPrice}}，涨跌幅 {{quote.changePct}}。', evidenceIds: ['M01'], kind: 'evidence', followups: [] };
  const parsed = parseChatReply(answer, market);
  assert.match(parsed.answer, /125\.50 元/); assert.match(parsed.answer, /0\.40 %/); assert.equal(parsed.facts[0].page, 0);
  assert.equal(parseChatReply(answer), null);
  assert.equal(parseChatReply(answer, { status: 'unavailable', code: 'TIMEOUT', message: '连接失败' }), null);
  assert.equal(parseChatReply({ ...answer, evidenceIds: ['E04'] }, market), null);
  assert.match(buildChatPrompt({ status: 'unavailable', code: 'NO_DATA', message: '未返回' }), /不能复用历史对话/);
});
test('端到端将真实接口形状送入模型，并带回可追溯行情', async () => {
  process.env.ENABLE_CHAT_PREVIEW = 'true'; process.env.FUYAO_API_KEY = 'test-fuyao-e2e';
  process.env.LLM_API_KEY = 'test-model-key'; process.env.LLM_BASE_URL = 'https://api.groq.com/openai/v1';
  let receivedQuote = false;
  globalThis.fetch = async (url, options) => {
    if (url.startsWith('https://fuyao.')) return Response.json(fixture());
    const payload = JSON.parse(options.body);
    receivedQuote = payload.messages[0].content.includes('quote.lastPrice=125.50 元');
    return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: '截至 {{quote.asOf}}，最新成交价 {{quote.lastPrice}}。', kind: 'evidence', evidenceIds: ['M01'], followups: [] }) } }] });
  };
  const response = await POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: '股价和经营质量应该如何一起理解？' }] }) }));
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(receivedQuote, true);
  assert.equal(result.mode, 'llm'); assert.equal(result.market.quote.lastPrice, 125.5);
  assert.ok(!JSON.stringify(result).includes('test-fuyao-e2e')); assert.ok(!JSON.stringify(result).includes('test-model-key'));
});
test('行情端点关闭预览时不可用，未配置时返回明确状态', async () => {
  delete process.env.ENABLE_CHAT_PREVIEW; assert.equal((await GET()).status, 404);
  process.env.ENABLE_CHAT_PREVIEW = 'true'; delete process.env.FUYAO_API_KEY;
  const response = await GET(); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'NOT_CONFIGURED');
});
