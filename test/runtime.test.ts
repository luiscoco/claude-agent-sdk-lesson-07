import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { HookInput, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createHooks, counters } from '../src/server/hooks.js';
import { runLive, type QueryFactory } from '../src/server/runner.js';
import { createApiHandler } from '../src/server/app.js';
import { DEFAULT_CONFIG, type Frame } from '../src/shared/lesson.js';
import { ConfigSchema } from '../src/server/config.js';
const input = {
  hook_event_name: 'PreToolUse',
  session_id: 'test',
  cwd: '.',
  transcript_path: '',
  tool_name: 'mcp__lesson__observe_note',
  tool_input: {},
} as HookInput;
test('hook flags do not change registered callbacks', () => {
  assert.deepEqual(
    Object.keys(createHooks(DEFAULT_CONFIG, counters(), () => {})),
    Object.keys(createHooks({ ...DEFAULT_CONFIG, includeHookEvents: false }, counters(), () => {})),
  );
});
test('PreToolUse explicit denial is separate from logging', async () => {
  const c = counters(),
    rows: unknown[] = [];
  const h = createHooks({ ...DEFAULT_CONFIG, scenario: 'blocked' }, c, (x) => rows.push(x));
  const r = await h.PreToolUse![0]!.hooks[0]!(input, 't1', {
    signal: new AbortController().signal,
  });
  assert.equal(c.hookDenials, 1);
  assert.equal(c.handlerCalls, 0);
  assert.equal(c.callbacks.PreToolUse, 1);
  assert.equal(rows.length, 2);
  assert.equal(
    (r as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput
      .permissionDecision,
    'deny',
  );
});
test('PermissionRequest logger grants no approval', async () => {
  const c = counters();
  const h = createHooks(DEFAULT_CONFIG, c, () => {});
  assert.deepEqual(
    await h.PermissionRequest![0]!.hooks[0]!(input, 't1', { signal: new AbortController().signal }),
    {},
  );
  assert.equal(c.callbacks.PermissionRequest, 1);
  assert.equal(c.permissionDecisions, 0);
});
test('PostToolUse supplies bounded additional context and Stop never blocks', async () => {
  const c = counters();
  const h = createHooks(DEFAULT_CONFIG, c, () => {});
  const result = await h.PostToolUse![0]!.hooks[0]!(input, 't1', {
    signal: new AbortController().signal,
  });
  assert.ok('hookSpecificOutput' in result);
  assert.deepEqual(
    await h.Stop![0]!.hooks[0]!(input, undefined, { signal: new AbortController().signal }),
    {},
  );
  assert.equal(c.callbacks.Stop, 1);
});
test('config rejects arbitrary tools, prompts and malformed flags', () => {
  assert.equal(ConfigSchema.safeParse({ ...DEFAULT_CONFIG, prompt: 'arbitrary' }).success, false);
  assert.equal(
    ConfigSchema.safeParse({ ...DEFAULT_CONFIG, includeHookEvents: 'true' }).success,
    false,
  );
});
const success = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'bounded test',
  total_cost_usd: 0,
  session_id: 'test',
} as SDKMessage;
test('runner passes pinned scenario flags, closes and reports only observed counters', async () => {
  let closed = false;
  const frames: Frame[] = [];
  const factory: QueryFactory = ({ options }) => {
    assert.deepEqual(options?.tools, []);
    assert.equal(options?.includeHookEvents, false);
    assert.equal(options?.persistSession, false);
    assert.equal(options?.maxBudgetUsd, 0.25);
    assert.equal(options?.permissionMode, 'default');
    return {
      [Symbol.asyncIterator]: async function* () {
        yield success;
      },
      close() {
        closed = true;
      },
    };
  };
  const r = await runLive(
    { ...DEFAULT_CONFIG, includeHookEvents: false },
    new AbortController().signal,
    (f) => frames.push(f),
    factory,
  );
  assert.equal(r.sdkOk, true);
  assert.equal(r.counters.callbacks.SessionStart, 0);
  assert.equal(r.hookFrames, 0);
  assert.ok(closed);
  assert.equal(frames.at(-1)?.title, 'Host cleanup');
});
test('stream termination without a result is an error with cleanup', async () => {
  let closed = false;
  const factory: QueryFactory = () => ({
    [Symbol.asyncIterator]: async function* () {},
    close() {
      closed = true;
    },
  });
  await assert.rejects(
    runLive(DEFAULT_CONFIG, new AbortController().signal, () => {}, factory),
    /without a result/,
  );
  assert.ok(closed);
});
test('pre-aborted and replay-only scenarios never construct a query', async () => {
  const factory: QueryFactory = () => {
    throw Error('must not execute');
  };
  await assert.rejects(runLive(DEFAULT_CONFIG, AbortSignal.abort(), () => {}, factory));
  await assert.rejects(
    runLive(
      { ...DEFAULT_CONFIG, scenario: 'reset' },
      new AbortController().signal,
      () => {},
      factory,
    ),
    /replay scenario/,
  );
});
test('HTTP metadata, replay, source and live validation are bounded', async () => {
  const api = createApiHandler({ liveAvailable: false });
  const server = createServer((req, res) => void api(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;
  const post = (path: string, value: unknown, headers = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(value),
    });
  try {
    const meta = await (await fetch(base + '/api/meta')).json();
    assert.equal(meta.liveAvailable, false);
    assert.ok(!JSON.stringify(meta).includes('ANTHROPIC_API_KEY'));
    assert.equal((await post('/api/live', DEFAULT_CONFIG)).status, 409);
    assert.equal((await post('/api/live', { ...DEFAULT_CONFIG, scenario: 'reset' })).status, 400);
    assert.equal((await post('/api/replay', { ...DEFAULT_CONFIG, extra: true })).status, 400);
    assert.equal(
      (await post('/api/replay', DEFAULT_CONFIG, { Origin: 'https://external.example' })).status,
      403,
    );
    const replay = await (await post('/api/replay', DEFAULT_CONFIG)).json();
    assert.equal(replay.fixture, true);
    assert.ok(replay.frames.length > 10);
    const source = await (await fetch(base + '/api/source')).json();
    assert.equal(source.filename, 'src/server/hooks.ts');
    assert.ok(source.content.includes('PermissionRequest'));
  } finally {
    await api.dispose();
    server.closeAllConnections();
    await new Promise<void>((r, e) => server.close((x) => (x ? e(x) : r())));
  }
});
