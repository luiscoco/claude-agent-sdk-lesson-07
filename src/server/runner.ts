import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { InputQueue } from './input.js';
import { ConfigSchema, childEnvironment } from './config.js';
import { createHooks, counters, OBSERVE_TOOL, type Emit } from './hooks.js';
import { createLessonServer } from './tools.js';
import { FIXTURE_ROOT, CONFIG_DIRECTORY } from './paths.js';
import { projectMessage } from '../shared/observe.js';
import type { Config, Frame, Report } from '../shared/lesson.js';
export type QueryFactory = (
  input: Parameters<typeof query>[0],
) => AsyncIterable<SDKMessage> & Pick<Query, 'close'>;
export function promptFor(config: Config) {
  if (config.scenario === 'permission')
    return 'Call protected_preview with label="lesson-preview" exactly once. The host may deny permission. Report the outcome in one sentence and do not retry or call other tools.';
  return `Call observe_note with topic="${config.scenario === 'failure' ? 'missing' : 'project'}" exactly once. ${config.scenario === 'blocked' ? 'A hook will deny it. ' : ''}Explain the result in two short sentences. Do not retry or use other tools.`;
}
export async function runLive(
  input: unknown,
  signal: AbortSignal,
  onFrame: (frame: Frame) => void,
  queryFactory: QueryFactory = query,
): Promise<Report> {
  const config = ConfigSchema.parse(input);
  if (config.scenario === 'reset')
    throw new Error('Progress/reset is an explicitly labeled replay scenario, not a live query.');
  signal.throwIfAborted();
  let sequence = 0;
  const emit: Emit = (frame) => onFrame({ ...frame, sequence: ++sequence });
  const counts = counters();
  const server = createLessonServer(counts, emit);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 90000);
  const messages = new InputQueue<SDKUserMessage>();
  let handle: ReturnType<QueryFactory> | undefined;
  let report: Report | undefined;
  let sdkMessages = 0,
    hookFrames = 0,
    partialMessages = 0;
  try {
    await mkdir(CONFIG_DIRECTORY, { recursive: true });
    controller.signal.throwIfAborted();
    messages.push({
      type: 'user',
      message: { role: 'user', content: promptFor(config) },
      parent_tool_use_id: null,
      session_id: '',
      uuid: randomUUID(),
    });
    emit({
      origin: 'live',
      lane: 'host',
      category: 'runtime',
      title: 'Real SDK query created',
      detail:
        'Hooks and message flags are independent options. No file or command built-ins are enabled.',
      envelope: {
        includeHookEvents: config.includeHookEvents,
        includePartialMessages: config.includePartialMessages,
      },
    });
    handle = queryFactory({
      prompt: messages,
      options: {
        cwd: FIXTURE_ROOT,
        env: childEnvironment(),
        tools: [],
        allowedTools: [OBSERVE_TOOL],
        permissionMode: 'default',
        mcpServers: { lesson: server },
        skills: [],
        settingSources: [],
        persistSession: false,
        maxTurns: 6,
        maxBudgetUsd: 0.25,
        abortController: controller,
        includeHookEvents: config.includeHookEvents,
        includePartialMessages: config.includePartialMessages,
        hooks: createHooks(config, counts, emit),
        ...(process.env.ANTHROPIC_MODEL ? { model: process.env.ANTHROPIC_MODEL } : {}),
        canUseTool: async (name, _args, context) => {
          counts.permissionDecisions++;
          emit({
            origin: 'live',
            lane: 'policy',
            category: 'policy',
            title: 'canUseTool denied permission',
            detail:
              'This separate host policy denies every request reaching it. Logging grants nothing.',
            toolUseId: context.toolUseID,
            envelope: { tool_name: name, behavior: 'deny' },
          });
          return {
            behavior: 'deny',
            message: 'The lesson host denies this protected preview. Do not retry.',
          };
        },
        systemPrompt:
          'You are a concise TypeScript course tutor. Make only the exact lesson tool call requested, once. A tool error or denial is expected in some cases. Explain it accurately without retries or workarounds. No files may be changed and no commands are available.',
      },
    });
    for await (const message of handle) {
      controller.signal.throwIfAborted();
      sdkMessages++;
      const view = projectMessage(message);
      if (view.category === 'hook-lifecycle') hookFrames++;
      if (message.type === 'stream_event') partialMessages++;
      emit({ ...view, origin: 'live', lane: 'sdk' });
      if (message.type === 'result') {
        report = {
          sdkOk: view.final?.ok ?? false,
          text: view.final?.text || 'No recognizable result.',
          counters: structuredClone(counts),
          costUsd: message.total_cost_usd,
          sdkMessages,
          hookFrames,
          partialMessages,
        };
        break;
      }
    }
    if (!report) throw new Error('The SDK stream ended without a result.');
    return report;
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener('abort', abort);
    messages.close();
    try {
      handle?.close();
    } finally {
      await server.instance.close().catch(() => {});
    }
    emit({
      origin: 'live',
      lane: 'host',
      category: 'runtime',
      title: 'Host cleanup',
      detail:
        'Query, input, server, abort listener and timer released. Stop callback is a different observation.',
      envelope: {},
    });
  }
}
