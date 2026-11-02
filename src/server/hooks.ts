import type { Options, HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk';
import { HOOKS, type HookName, type Config, type Counters, type Frame } from '../shared/lesson.js';
import { clean } from '../shared/observe.js';
export const OBSERVE_TOOL = 'mcp__lesson__observe_note',
  PROTECTED_TOOL = 'mcp__lesson__protected_preview';
export type Emit = (frame: Omit<Frame, 'sequence'>) => void;
export const counters = (): Counters => ({
  callbacks: Object.fromEntries(HOOKS.map((name) => [name, 0])) as Counters['callbacks'],
  handlerCalls: 0,
  handlerFailures: 0,
  protectedCalls: 0,
  hookDenials: 0,
  permissionDecisions: 0,
});
export function createHooks(
  config: Config,
  counts: Counters,
  emit: Emit,
): NonNullable<Options['hooks']> {
  const log = (name: HookName, input: HookInput, toolUseId?: string) => {
    counts.callbacks[name]++;
    const data = input as unknown as Record<string, unknown>;
    emit({
      origin: 'live',
      lane: 'callback',
      category: name === 'PermissionRequest' ? 'policy' : 'runtime',
      hookEvent: name,
      title: `${name} callback`,
      detail:
        name === 'PostToolUseFailure'
          ? clean(data.error) || 'Observed tool failure.'
          : name === 'PermissionRequest'
            ? 'Logged a permission request; this callback returns no approval.'
            : `Host callback executed for ${name}.`,
      ...(typeof data.session_id === 'string' ? { sessionId: data.session_id } : {}),
      ...(toolUseId ? { toolUseId } : {}),
      envelope: {
        hook_event_name: name,
        ...(typeof data.tool_name === 'string' ? { tool_name: clean(data.tool_name, 150) } : {}),
        ...(toolUseId ? { tool_use_id: toolUseId } : {}),
      },
    });
  };
  const observer =
    (name: HookName): HookCallback =>
    async (input, id) => {
      log(name, input, id);
      return {};
    };
  const pre: HookCallback = async (input, id) => {
    log('PreToolUse', input, id);
    if (config.scenario === 'blocked') {
      counts.hookDenials++;
      emit({
        origin: 'live',
        lane: 'policy',
        category: 'policy',
        title: 'PreToolUse denied the call',
        detail: 'A logging callback is separate from this explicit deny decision.',
        ...(id ? { toolUseId: id } : {}),
        envelope: { permissionDecision: 'deny' },
      });
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'The lesson scenario blocks this call before execution. Do not retry.',
        },
      };
    }
    return {};
  };
  const post: HookCallback = async (input, id) => {
    log('PostToolUse', input, id);
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'The lesson host observed this outcome. Keep the final explanation concise.',
      },
    };
  };
  const matcher = '^mcp__lesson__(observe_note|protected_preview)$';
  return {
    SessionStart: [{ hooks: [observer('SessionStart')] }],
    PreToolUse: [{ matcher, hooks: [pre] }],
    PostToolUse: [{ matcher, hooks: [post] }],
    PostToolUseFailure: [{ matcher, hooks: [observer('PostToolUseFailure')] }],
    PermissionRequest: [{ matcher, hooks: [observer('PermissionRequest')] }],
    Notification: [{ hooks: [observer('Notification')] }],
    Stop: [{ hooks: [observer('Stop')] }],
  };
}
