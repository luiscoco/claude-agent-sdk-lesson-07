import type { Projection, State, Frame, Category } from './lesson.js';
const object = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
export const clean = (v: unknown, limit = 2500) =>
  typeof v === 'string' ? v.replace(/sk-ant-[\w-]+/g, '[redacted]').slice(0, limit) : '';
const numeric = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
/** Selected-field teaching presenter, not the complete SDK message schema. */
export function projectMessage(input: unknown): Projection {
  const data = object(input);
  const type = clean(data.type, 80) || 'unknown';
  const subtype = clean(data.subtype, 80);
  const envelope: Record<string, unknown> = { type, ...(subtype ? { subtype } : {}) };
  const sessionId = clean(data.session_id, 100) || undefined;
  const base = {
    title: type + (subtype ? ' · ' + subtype : ''),
    envelope,
    ...(sessionId ? { sessionId } : {}),
  };
  if (type === 'conversation_reset') {
    const newId = clean(data.new_conversation_id, 100) || 'unspecified';
    return {
      ...base,
      category: 'reset',
      detail: 'Reset conversation UI state; this is not a final failure.',
      reset: { newId },
      envelope: {
        ...envelope,
        new_conversation_id: newId,
        trigger: clean(data.trigger, 100) || 'unspecified',
      },
    };
  }
  if (type === 'result') {
    const ok = subtype === 'success' && data.is_error === false && typeof data.result === 'string';
    const text = ok
      ? clean(data.result)
      : Array.isArray(data.errors)
        ? data.errors.map((e) => clean(e)).join('\n')
        : 'The result was unsuccessful or its shape was not recognized.';
    return {
      ...base,
      category: 'result',
      detail: text,
      final: { ok, text, costUsd: numeric(data.total_cost_usd) },
      envelope: {
        ...envelope,
        is_error: data.is_error === true,
        subtype: subtype || 'unspecified',
        ...(ok ? { result: text } : { errors: text }),
      },
    };
  }
  if (type === 'stream_event') {
    const event = object(data.event);
    const delta = object(event.delta);
    const eventType = clean(event.type, 80);
    const text =
      eventType === 'content_block_delta' && delta.type === 'text_delta' ? clean(delta.text) : '';
    return {
      ...base,
      category: 'conversation',
      title: 'stream_event · ' + (eventType || 'unknown'),
      detail: text || 'Streaming control frame; non-text payload omitted.',
      draft: eventType === 'message_start' ? { start: true } : text ? { text } : {},
      envelope: {
        ...envelope,
        event: { type: eventType, ...(text ? { delta: { type: 'text_delta', text } } : {}) },
      },
    };
  }
  if (type === 'assistant' || type === 'user') {
    const body = object(data.message);
    const content = body.content;
    const blocks = Array.isArray(content) ? content.map(object) : [];
    const selected = blocks.flatMap<Record<string, string>>((block) =>
      block.type === 'text'
        ? [{ type: 'text', text: clean(block.text) }]
        : block.type === 'tool_use'
          ? [{ type: 'tool_use', id: clean(block.id, 120), name: clean(block.name, 150) }]
          : block.type === 'tool_result'
            ? [{ type: 'tool_result', tool_use_id: clean(block.tool_use_id, 120) }]
            : [],
    );
    const text =
      typeof content === 'string'
        ? clean(content)
        : selected
            .map((block) =>
              'text' in block
                ? block.text
                : block.type === 'tool_use'
                  ? `Tool request: ${'name' in block ? block.name : ''}`
                  : '[tool result]',
            )
            .join('\n');
    const tool = blocks.find((block) => block.type === 'tool_use');
    const toolResult = blocks.find((block) => block.type === 'tool_result');
    return {
      ...base,
      category: 'conversation',
      detail: text || 'Non-text conversation block omitted.',
      ...(text ? { conversation: { role: type, text } } : {}),
      ...(tool
        ? { toolUseId: clean(tool.id, 120) }
        : toolResult
          ? { toolUseId: clean(toolResult.tool_use_id, 120) }
          : {}),
      envelope: {
        ...envelope,
        message: { content: typeof content === 'string' ? clean(content) : selected },
      },
    };
  }
  if (type === 'system' && ['hook_started', 'hook_progress', 'hook_response'].includes(subtype)) {
    const hookId = clean(data.hook_id, 120);
    return {
      ...base,
      category: 'hook-lifecycle',
      detail: `${clean(data.hook_event, 100) || 'Hook'} lifecycle observation. Callback execution is counted separately.`,
      hookId,
      envelope: {
        ...envelope,
        hook_id: hookId,
        hook_event: clean(data.hook_event, 100),
        hook_name: clean(data.hook_name, 100),
        ...(data.outcome ? { outcome: clean(data.outcome, 60) } : {}),
      },
    };
  }
  if (
    type === 'tool_progress' ||
    (type === 'system' &&
      ['task_started', 'task_progress', 'task_notification', 'task_updated'].includes(subtype))
  ) {
    const progress =
      clean(data.summary) ||
      clean(data.description) ||
      clean(data.status) ||
      'Task/tool progress update.';
    const toolUseId = clean(data.tool_use_id, 120) || undefined;
    return {
      ...base,
      category: 'progress',
      detail: progress,
      progress,
      ...(toolUseId ? { toolUseId } : {}),
      envelope: {
        ...envelope,
        task_id: clean(data.task_id, 120),
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
        usage: {
          total_tokens: numeric(object(data.usage).total_tokens),
          duration_ms: numeric(object(data.usage).duration_ms),
        },
      },
    };
  }
  if (type === 'system' && subtype === 'permission_denied')
    return {
      ...base,
      category: 'policy',
      detail: 'The SDK reported a permission denial. This is separate from final query success.',
    };
  if (type === 'system')
    return {
      ...base,
      category: 'runtime',
      detail: clean(data.content) || 'Runtime event observed. Not conversation text.',
    };
  return {
    ...base,
    category: 'unknown',
    detail:
      'Unrecognized message family retained as an observation; no final/reset action inferred.',
  };
}
export function initialState(): State {
  return {
    events: [],
    messages: 0,
    callbacks: 0,
    resets: 0,
    sessionId: null,
    conversation: [],
    progress: null,
    draft: '',
    final: null,
    categories: Object.fromEntries(
      [
        'conversation',
        'progress',
        'hook-lifecycle',
        'reset',
        'result',
        'runtime',
        'policy',
        'handler',
        'unknown',
      ].map((k) => [k, 0]),
    ) as Record<Category, number>,
  };
}
export function applyFrame(previous: State, frame: Frame): State {
  const state: State = {
    ...previous,
    events: [...previous.events, frame].slice(-200),
    categories: {
      ...previous.categories,
      [frame.category]: previous.categories[frame.category] + 1,
    },
    conversation: [...previous.conversation],
  };
  if (frame.lane === 'sdk') {
    state.messages++;
    if (frame.sessionId && !state.sessionId) state.sessionId = frame.sessionId;
  }
  if (frame.lane === 'callback') state.callbacks++;
  if (frame.reset) {
    state.resets++;
    state.sessionId = frame.reset.newId;
    state.conversation = [];
    state.progress = null;
    state.draft = '';
    state.final = null;
  } else if (frame.sessionId && state.sessionId && frame.sessionId !== state.sessionId) {
    // Keep late old-conversation events in the audit without restoring stale UI state.
    return state;
  }
  if (frame.conversation)
    state.conversation = [...state.conversation, frame.conversation].slice(-40);
  if (frame.progress) state.progress = frame.progress;
  if (frame.draft?.start) state.draft = '';
  if (frame.draft?.text) state.draft = (state.draft + frame.draft.text).slice(-12000);
  if (frame.final) state.final = frame.final;
  return state;
}
