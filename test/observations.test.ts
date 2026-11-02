import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectMessage, initialState, applyFrame } from '../src/shared/observe.js';
import { DEFAULT_CONFIG, type Frame } from '../src/shared/lesson.js';
import { replayFrames } from '../src/server/fixtures.js';
import { createEventParser } from '../src/shared/sse.js';
const frame = (data: unknown): Frame => ({
  ...projectMessage(data),
  origin: 'fixture',
  lane: 'sdk',
  sequence: 1,
});
test('unknown and malformed inputs never infer a final result', () => {
  for (const x of [null, {}, [], { type: 'future', result: 'not final' }])
    assert.equal(projectMessage(x).category, 'unknown');
});
test('progress and result update independent views', () => {
  let s = applyFrame(
    initialState(),
    frame({ type: 'result', subtype: 'success', is_error: false, result: 'done' }),
  );
  s = applyFrame(s, frame({ type: 'system', subtype: 'task_progress', description: 'working' }));
  assert.equal(s.final?.text, 'done');
  assert.equal(s.progress, 'working');
});
test('failed result does not become a successful final', () => {
  assert.equal(
    projectMessage({ type: 'result', subtype: 'error_max_turns', errors: ['limit'] }).final?.ok,
    false,
  );
  assert.equal(
    projectMessage({ type: 'result', subtype: 'success', result: 'missing is_error' }).final?.ok,
    false,
  );
});
test('selected projection omits thinking, inputs and raw tool content', () => {
  const p = projectMessage({
    type: 'assistant',
    message: {
      content: [
        { type: 'thinking', thinking: 'PRIVATE' },
        { type: 'tool_use', name: 'safe', id: 't1', input: { password: 'PRIVATE' } },
      ],
    },
  });
  assert.ok(!JSON.stringify(p).includes('PRIVATE'));
  assert.equal(p.toolUseId, 't1');
  const r = projectMessage({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'PRIVATE' }] },
  });
  assert.equal(r.toolUseId, 't1');
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('hook IDs do not masquerade as tool-use IDs', () => {
  const p = projectMessage({
    type: 'system',
    subtype: 'hook_response',
    hook_id: 'h1',
    hook_event: 'Stop',
    stdout: 'PRIVATE',
  });
  assert.equal(p.hookId, 'h1');
  assert.equal(p.toolUseId, undefined);
  assert.ok(!JSON.stringify(p).includes('PRIVATE'));
});
test('text redacts credential-like tokens', () => {
  assert.ok(
    !projectMessage({
      type: 'assistant',
      message: { content: 'sk-ant-test_secret_value' },
    }).detail.includes('sk-ant-'),
  );
});
test('unknown reset trigger clears UI, preserves audit and ignores late old-session progress', () => {
  let s = initialState();
  s = applyFrame(
    s,
    frame({ type: 'assistant', session_id: 'old', message: { content: 'old answer' } }),
  );
  s = applyFrame(
    s,
    frame({
      type: 'result',
      session_id: 'old',
      subtype: 'success',
      is_error: false,
      result: 'old',
    }),
  );
  s = applyFrame(
    s,
    frame({
      type: 'conversation_reset',
      session_id: 'old',
      new_conversation_id: 'new',
      trigger: 'future-trigger',
    }),
  );
  assert.equal(s.sessionId, 'new');
  assert.equal(s.conversation.length, 0);
  assert.equal(s.final, null);
  assert.equal(s.resets, 1);
  s = applyFrame(
    s,
    frame({ type: 'system', subtype: 'task_progress', session_id: 'old', description: 'stale' }),
  );
  assert.equal(s.progress, null);
  assert.equal(s.sessionId, 'new');
  assert.equal(s.events.length, 4);
});
test('compaction does not reset the conversation', () => {
  let s = applyFrame(initialState(), frame({ type: 'assistant', message: { content: 'keep' } }));
  s = applyFrame(s, frame({ type: 'system', subtype: 'compact_boundary' }));
  assert.equal(s.conversation[0]?.text, 'keep');
  assert.equal(s.resets, 0);
});
test('partial and completed assistant text never concatenate into one answer', () => {
  let s = applyFrame(
    initialState(),
    frame({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
    }),
  );
  s = applyFrame(s, frame({ type: 'assistant', message: { content: 'hello' } }));
  assert.equal(s.draft, 'hello');
  assert.deepEqual(s.conversation, [{ role: 'assistant', text: 'hello' }]);
});
test('audit is bounded while counters retain total', () => {
  let s = initialState();
  for (let i = 0; i < 240; i++) s = applyFrame(s, frame({ type: 'system', subtype: 'init' }));
  assert.equal(s.events.length, 200);
  assert.equal(s.messages, 240);
});
test('replay flags filter lifecycle and partial frames without removing scripted callback rows', () => {
  const all = replayFrames(DEFAULT_CONFIG),
    less = replayFrames({
      ...DEFAULT_CONFIG,
      includeHookEvents: false,
      includePartialMessages: false,
    });
  assert.ok(all.length > less.length);
  assert.equal(
    all.filter((x) => x.lane === 'callback').length,
    less.filter((x) => x.lane === 'callback').length,
  );
  assert.ok(less.every((x) => x.origin === 'fixture'));
  assert.ok(!less.some((x) => x.title.startsWith('stream_event')));
  assert.ok(
    less
      .filter((x) => x.category === 'hook-lifecycle')
      .every((x) => x.envelope.hook_event === 'SessionStart'),
  );
});
test('reset teaching fixture ends in the new conversation', () => {
  const frames = replayFrames({ ...DEFAULT_CONFIG, scenario: 'reset' });
  const s = frames.reduce(applyFrame, initialState());
  assert.equal(s.resets, 1);
  assert.equal(s.final?.ok, true);
  assert.ok(!s.conversation.some((x) => x.text.includes('old conversation')));
  assert.ok(s.categories.unknown > 0);
});
test('SSE parser retains fragmented and coalesced messages', () => {
  const out: unknown[] = [];
  const parse = createEventParser((x) => out.push(x));
  parse('data: {"a":');
  parse('1}\n\ndata: {"b":2}\n\n');
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
});
