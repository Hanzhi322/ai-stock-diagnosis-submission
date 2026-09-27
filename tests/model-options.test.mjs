import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
await build({entryPoints:['lib/model-options.ts'],outfile:'.sites-runtime/model-options-test.mjs',bundle:true,format:'esm',platform:'node',logLevel:'silent'});
const {modelOutputOptions}=await import('../.sites-runtime/model-options-test.mjs');
test('讯飞小模型为聊天和诊断保留正文输出，不让推理占满额度',()=>{
  for(const limit of [900,1000])assert.deepEqual(modelOutputOptions('https://maas-api.cn-huabei-1.xf-yun.com/v2','spark-x2.5-1.7b',limit),{max_tokens:2000,enable_thinking:false});
});
test('原Groq设置及其他服务商设置保持原行为',()=>{
  assert.deepEqual(modelOutputOptions('https://api.groq.com/openai/v1','openai/gpt-oss-120b',1000),{max_tokens:2000,reasoning_effort:'low'});
  assert.deepEqual(modelOutputOptions('https://example.com/v1','spark-x2.5-1.7b',900),{max_tokens:900});
  assert.deepEqual(modelOutputOptions('https://maas-api.cn-huabei-1.xf-yun.com/v2','another-model',1000),{max_tokens:1000});
});
