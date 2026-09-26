import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({entryPoints:['lib/ifind-transport.ts'],outfile:'.sites-runtime/transport-tests/ifind-transport.js',bundle:true,format:'esm',platform:'node',logLevel:'silent'});
const {decodeIfindHttp,postIfindMcp}=await import('../.sites-runtime/transport-tests/ifind-transport.js');
const response=(headers,body,status=200)=>Buffer.from(`HTTP/1.1 ${status} OK\r\n${headers}\r\n\r\n${body}`);
test('TLS HTTP parser waits for full UTF-8 content-length and preserves session header',()=>{
 const body=JSON.stringify({id:1,result:'新闻'}), raw=response(`Content-Type: application/json\r\nMcp-Session-Id: session-test\r\nContent-Length: ${Buffer.byteLength(body)}`,body);
 assert.equal(decodeIfindHttp(raw.subarray(0,raw.length-2)),null);
 const out=decodeIfindHttp(raw);assert.equal(out.status,200);assert.equal(out.headers.get('mcp-session-id'),'session-test');assert.equal(Buffer.from(out.body).toString(),body);
});
test('TLS HTTP parser decodes chunked frames, extensions and fragmented delivery',()=>{
 const raw=response('Transfer-Encoding: chunked','3;part=one\r\nabc\r\n2\r\nde\r\n0\r\n\r\n');
 assert.equal(decodeIfindHttp(raw.subarray(0,raw.length-7)),null);
 const out=decodeIfindHttp(raw);assert.equal(Buffer.from(out.body).toString(),'abcde');assert.equal(out.headers.has('transfer-encoding'),false);
});
test('TLS HTTP parser accepts empty initialized notification response',()=>{
 const out=decodeIfindHttp(response('Content-Length: 0','',202));assert.equal(out.status,202);assert.equal(out.body.length,0);
});
test('TLS MCP transport stops at matching SSE event without waiting for stream end',()=>{
 const body='data: '+JSON.stringify({id:3,result:{ok:true}})+'\n\n';
 const raw=response('Content-Type: text/event-stream\r\nTransfer-Encoding: chunked',Buffer.byteLength(body).toString(16)+'\r\n'+body+'\r\n');
 assert.equal(decodeIfindHttp(raw,false,2),null);assert.ok(decodeIfindHttp(raw,false,3));
});
test('TLS HTTP parser rejects truncated and invalid chunked framing',()=>{
 assert.throws(()=>decodeIfindHttp(response('Content-Length: 10','abc'),true),/TRUNCATED/);
 assert.throws(()=>decodeIfindHttp(response('Transfer-Encoding: chunked','x\r\nabc'),true),/INVALID_CHUNK/);
 assert.throws(()=>decodeIfindHttp(response('Transfer-Encoding: chunked\r\nContent-Length: 0','0\r\n\r\n')),/AMBIGUOUS/);
 assert.throws(()=>decodeIfindHttp(Buffer.from('not HTTP'),true),/INVALID_HEADERS/);
});
test('TLS HTTP parser enforces response limits and identity encoding',()=>{
 assert.throws(()=>decodeIfindHttp(Buffer.alloc(300001)),/TOO_LARGE/);
 assert.throws(()=>decodeIfindHttp(response('Content-Encoding: gzip','a'),true),/UNSUPPORTED_ENCODING/);
 assert.throws(()=>decodeIfindHttp(response('Content-Length: -1','a')),/INVALID_LENGTH/);
});
test('TLS MCP transport rejects header injection before opening a connection',async()=>{
 await assert.rejects(()=>postIfindMcp({Authorization:'secret\r\nOther: value'},'{}',new AbortController().signal),/INVALID_REQUEST_HEADER/);
});
test('TLS MCP transport rejects an aborted request before opening a connection',async()=>{
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 await assert.rejects(()=>postIfindMcp({},'{}',controller.signal),/cancelled/);
});
