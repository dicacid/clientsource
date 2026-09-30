import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonObject, requestJsonResponse } from '../src/lib/spa/json-response.server.ts';

const evidence = { organisations: [{ name: 'Example', source_url: 'https://example.com/a?q=1', why_relevant: 'A {literal} bracket and "quoted" fact.' }] };
const text = JSON.stringify(evidence);
for (const [name, input] of [['plain', text], ['fenced', '```json\n' + text + '\n```'], ['narrated', 'I researched this.\n' + text + '\nResearch complete.']]) {
  test(`extracts ${name} complete JSON without changing evidence`, () => assert.deepEqual(parseJsonObject(input), evidence));
}
test('repairs missing commas and trailing commas without changing strings or URLs', () => {
  assert.deepEqual(parseJsonObject('{"organisations":[{"name":"Example" "source_url":"https://example.com/a?q=1",},],}'), { organisations: [{name:'Example', source_url:'https://example.com/a?q=1'}] });
});
test('rejects truncated outer objects rather than extracting a nested partial result', () => {
  assert.throws(() => parseJsonObject('{"organisations":[{"name":"Example"}'));
});
test('rejects empty results and scalar JSON', () => {
  for (const input of ['{}', 'null', '42', '[]']) assert.throws(() => parseJsonObject(input));
});

async function mocked(responses, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const response = responses.shift();
    assert.ok(response, 'unexpected extra API request');
    return new Response(JSON.stringify(response.body), { status: response.status ?? 200 });
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}
const opts = { apiKey:'test-key', model:'test/model', system:'Return companies', user:'Return JSON {"companies":[]}' };
const answer = (content, finish_reason = 'stop') => ({body:{model:'test/model',choices:[{message:{content},finish_reason}],usage:{completion_tokens:10,cost:0.001}}});
test('retries reasoning-only truncated answers with more output room and totals usage', async () => {
  await mocked([answer(null,'length'), answer('{"companies":[]}')], async (calls) => {
    const result = await requestJsonResponse(opts);
    assert.deepEqual(result.data,{companies:[]});
    assert.equal(calls.length,2);
    assert.ok(calls[1].max_tokens > calls[0].max_tokens);
    assert.equal(result.usage.completion_tokens,20);
    assert.equal(result.usage.cost,0.002);
  });
});
test('never treats length-limited syntactically valid content as a complete scan', async () => {
  await mocked([answer('{"companies":[]}', 'length'),answer('{"companies":[{"name":"Complete"}]}')], async (calls) => {
    const result = await requestJsonResponse(opts);
    assert.equal(result.data.companies[0].name,'Complete'); assert.equal(calls.length,2);
  });
});
test('handles content block arrays', async () => {
  await mocked([answer([{type:'text',text:'{"companies":[]}'}])], async () => assert.deepEqual((await requestJsonResponse(opts)).data,{companies:[]}));
});
test('falls back only when JSON mode is explicitly rejected', async () => {
  await mocked([{status:400,body:{error:{message:'response_format is unsupported'}}}, answer('{"companies":[]}')], async calls => {
    await requestJsonResponse(opts); assert.ok(calls[0].response_format); assert.equal(calls[1].response_format,undefined);
  });
});
test('reports credit failure immediately without retries', async () => {
  await mocked([{status:402,body:{error:{message:'insufficient credits'}}}], async calls => {
    await assert.rejects(requestJsonResponse(opts), /insufficient credits/); assert.equal(calls.length,1);
  });
});
test('rejects error envelopes even with HTTP 200', async () => {
  await mocked([{body:{error:{message:'provider failed'}}}], async () => assert.rejects(requestJsonResponse(opts), /provider failed/));
});
test('bounds automatic empty-answer retries', async () => {
  await mocked([answer(null),answer(null),answer(null)], async calls => {
    await assert.rejects(requestJsonResponse(opts), /Automatic retries were exhausted/); assert.equal(calls.length,3);
  });
});
