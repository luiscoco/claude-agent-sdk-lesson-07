import { projectMessage } from '../shared/observe.js';
import type { Config, Frame, HookName } from '../shared/lesson.js';
const SESSION = '11111111-1111-4111-8111-111111111111',
  NEXT = '22222222-2222-4222-8222-222222222222';
/** Scripted teaching frames, never presented as a recorded live run or as SDK execution. */
export function replayFrames(config: Config): Frame[] {
  const frames: Frame[] = [];
  let n = 0;
  const add = (frame: Omit<Frame, 'sequence' | 'origin'>) =>
    frames.push({ ...frame, origin: 'fixture', sequence: ++n });
  const sdk = (message: unknown) => {
    const view = projectMessage(message);
    if (
      view.category === 'hook-lifecycle' &&
      !config.includeHookEvents &&
      !['SessionStart', 'Setup'].includes(String(view.envelope.hook_event))
    )
      return;
    if (view.title.startsWith('stream_event') && !config.includePartialMessages) return;
    add({ ...view, lane: 'sdk' });
  };
  const callback = (name: HookName, toolUseId?: string) => {
    const hookId = 'fixture-hook-' + name;
    sdk({
      type: 'system',
      subtype: 'hook_started',
      hook_id: hookId,
      hook_name: 'fixture-callback',
      hook_event: name,
      session_id: SESSION,
    });
    add({
      lane: 'callback',
      category: name === 'PermissionRequest' ? 'policy' : 'runtime',
      title: name + ' callback · fixture',
      detail: 'Scripted callback observation; no host hook function executes in replay.',
      hookEvent: name,
      sessionId: SESSION,
      ...(toolUseId ? { toolUseId } : {}),
      envelope: { hook_event_name: name, fixture: true },
    });
    sdk({
      type: 'system',
      subtype: 'hook_response',
      hook_id: hookId,
      hook_name: 'fixture-callback',
      hook_event: name,
      outcome: 'success',
      session_id: SESSION,
    });
  };
  sdk({ type: 'system', subtype: 'init', session_id: SESSION });
  callback('SessionStart');
  sdk({
    type: 'user',
    session_id: SESSION,
    message: { content: 'Fixture task: explain message and hook responsibilities.' },
  });
  if (config.scenario === 'reset') {
    sdk({
      type: 'assistant',
      session_id: SESSION,
      message: { content: [{ type: 'text', text: 'Fixture: old conversation text.' }] },
    });
    sdk({
      type: 'system',
      subtype: 'task_progress',
      session_id: SESSION,
      task_id: 'fixture-task',
      description: 'Fixture task underway',
      usage: { total_tokens: 100, duration_ms: 250 },
    });
    sdk({
      type: 'conversation_reset',
      session_id: SESSION,
      new_conversation_id: NEXT,
      trigger: 'clear',
    });
    sdk({
      type: 'system',
      subtype: 'task_progress',
      session_id: SESSION,
      task_id: 'old-task',
      description: 'Late progress from the old conversation',
    });
    sdk({
      type: 'assistant',
      session_id: NEXT,
      message: { content: [{ type: 'text', text: 'Fixture: new conversation text after reset.' }] },
    });
    sdk({ type: 'system', subtype: 'compact_boundary', session_id: NEXT });
    sdk({
      type: 'future_event',
      session_id: NEXT,
      privatePayload: 'This payload is deliberately not projected.',
    });
    sdk({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: NEXT,
      result: 'Fixture result: the new conversation remains; reset was not a query failure.',
      total_cost_usd: 0,
    });
    return frames;
  }
  const toolUseId = 'fixture-tool-1';
  sdk({
    type: 'assistant',
    session_id: SESSION,
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name:
            config.scenario === 'permission'
              ? 'mcp__lesson__protected_preview'
              : 'mcp__lesson__observe_note',
          input: { private: 'omitted' },
        },
      ],
    },
  });
  callback('PreToolUse', toolUseId);
  if (config.scenario === 'blocked')
    add({
      lane: 'policy',
      category: 'policy',
      title: 'Fixture PreToolUse denial',
      detail: 'Illustrative explicit deny; no handler invocation.',
      toolUseId,
      envelope: { permissionDecision: 'deny' },
    });
  else if (config.scenario === 'permission') {
    callback('PermissionRequest', toolUseId);
    add({
      lane: 'policy',
      category: 'policy',
      title: 'Fixture host permission policy',
      detail: 'A separate policy denies the request. Logging does not approve it.',
      toolUseId,
      envelope: { behavior: 'deny' },
    });
  } else {
    add({
      lane: 'handler',
      category: 'handler',
      title: config.scenario === 'failure' ? 'Fixture tool error' : 'Fixture tool success',
      detail: 'Scripted handler outcome. No real tool executes in replay.',
      toolUseId,
      envelope: { isError: config.scenario === 'failure' },
    });
    callback(config.scenario === 'failure' ? 'PostToolUseFailure' : 'PostToolUse', toolUseId);
  }
  sdk({
    type: 'user',
    session_id: SESSION,
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'Fixture result',
          is_error: config.scenario !== 'success',
        },
      ],
    },
  });
  sdk({
    type: 'stream_event',
    session_id: SESSION,
    event: { type: 'message_start', message: { id: 'fixture-message' } },
  });
  for (const text of ['Fixture: ', 'a tool outcome ', 'is separate from the final result.'])
    sdk({
      type: 'stream_event',
      session_id: SESSION,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    });
  sdk({
    type: 'assistant',
    session_id: SESSION,
    message: {
      content: [
        { type: 'text', text: 'Fixture: a tool outcome is separate from the final result.' },
      ],
    },
  });
  callback('Stop');
  sdk({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: SESSION,
    result: 'Fixture final answer: the scenario completed; inspect its separate observations.',
    total_cost_usd: 0,
  });
  return frames;
}
