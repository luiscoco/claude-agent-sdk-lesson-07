export const VERSION = '0.3.310';
export type Scenario = 'success' | 'failure' | 'blocked' | 'permission' | 'reset';
export type Category =
  | 'conversation'
  | 'progress'
  | 'hook-lifecycle'
  | 'reset'
  | 'result'
  | 'runtime'
  | 'policy'
  | 'handler'
  | 'unknown';
export type Lane = 'sdk' | 'callback' | 'policy' | 'handler' | 'host';
export interface Config {
  scenario: Scenario;
  includeHookEvents: boolean;
  includePartialMessages: boolean;
}
export const DEFAULT_CONFIG: Config = {
  scenario: 'success',
  includeHookEvents: true,
  includePartialMessages: true,
};
export const SCENARIOS = {
  success: {
    title: 'Tool success',
    description: 'Observe session, pre/post-tool and stop callbacks around a bounded note read.',
  },
  failure: {
    title: 'Tool failure',
    description: 'A controlled MCP error demonstrates failure handling versus final query outcome.',
  },
  blocked: {
    title: 'Hook-blocked call',
    description: 'A PreToolUse decision blocks a pre-approved tool before its handler.',
  },
  permission: {
    title: 'Permission denied',
    description:
      'A permission request reaches a separate host denial policy. No protected handler should run.',
  },
  reset: {
    title: 'Progress & reset',
    description:
      'Replay only: task progress, a conversation reset, and a new result. No SDK query executes.',
  },
} as const;
export interface Projection {
  category: Category;
  title: string;
  detail: string;
  envelope: Record<string, unknown>;
  sessionId?: string;
  toolUseId?: string;
  hookId?: string;
  conversation?: { role: string; text: string };
  progress?: string;
  draft?: { start?: boolean; text?: string };
  reset?: { newId: string };
  final?: { ok: boolean; text: string; costUsd: number };
}
export interface Frame extends Projection {
  sequence: number;
  origin: 'fixture' | 'live';
  lane: Lane;
  hookEvent?: string;
}
export interface State {
  events: Frame[];
  messages: number;
  callbacks: number;
  resets: number;
  sessionId: string | null;
  conversation: { role: string; text: string }[];
  progress: string | null;
  draft: string;
  final: Projection['final'] | null;
  categories: Record<Category, number>;
}
export const HOOKS = [
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
] as const;
export type HookName = (typeof HOOKS)[number];
export interface Counters {
  callbacks: Record<HookName, number>;
  handlerCalls: number;
  handlerFailures: number;
  protectedCalls: number;
  hookDenials: number;
  permissionDecisions: number;
}
export interface Report {
  sdkOk: boolean;
  text: string;
  counters: Counters;
  costUsd: number;
  sdkMessages: number;
  hookFrames: number;
  partialMessages: number;
}
export const GUIDE = [
  {
    group: 'Typed messages',
    name: 'Inspect type, then subtype',
    text: 'Conversation, progress, result and runtime messages have different fields. The presenter reads selected fields and preserves unknown families as unknown instead of crashing.',
  },
  {
    group: 'Streaming text',
    name: 'Deltas ≠ completed blocks',
    text: 'stream_event text deltas are provisional. Completed assistant blocks form the conversation. This app keeps those views separate so it never concatenates both into one answer.',
  },
  {
    group: 'Outcome',
    name: 'result ≠ task_progress',
    text: 'Only a result supplies the final turn outcome. Progress describes work underway; a tool error or denial can still lead to a successful final explanation.',
  },
  {
    group: 'Reset',
    name: 'conversation_reset',
    text: 'Reset the displayed conversation, draft, progress and final result on every reset frame, including unknown triggers. Keep the audit trail. A compact_boundary is not a conversation reset.',
  },
  {
    group: 'Three observations',
    name: 'Callback / lifecycle frame / handler',
    text: 'A hook callback runs host code. includeHookEvents requests SDK hook lifecycle frames when emitted by the runtime. A tool handler performs work. They have separate lanes and counters.',
  },
  {
    group: 'Tool lifecycle',
    name: 'PreToolUse → PostToolUse or failure',
    text: 'Log callbacks with session and tool-use IDs. A PreToolUse deny prevents execution. The actual post-tool callback depends on the runtime outcome; inspect observed evidence rather than guessing from final text.',
  },
  {
    group: 'Approval',
    name: 'Logging does not grant permission',
    text: 'PermissionRequest logging returns no allow decision. The separate canUseTool policy denies the protected preview. No mutating capability or approval shortcut is hidden in a logging callback.',
  },
  {
    group: 'Session lifecycle',
    name: 'SessionStart / Stop / cleanup',
    text: 'SessionStart observes initialization. Stop observes the agent stopping, and is not the same as calling close() or receiving a result. Stop callbacks here never block or restart the turn.',
  },
  {
    group: 'Version contract',
    name: 'Hook matcher objects',
    text: 'SDK 0.3.310 uses hooks: { PostToolUse: [{ matcher, hooks: [callback] }] }. The lesson’s conceptual bare callback array must be adapted to that shape.',
  },
] as const;
export const QUIZ = [
  {
    question: 'Which message reports a final turn outcome?',
    answers: ['result', 'task_progress', 'hook_started'],
    correct: 0,
  },
  {
    question: 'Does includeHookEvents:false remove your configured callbacks?',
    answers: [
      'Yes',
      'No; it controls lifecycle messages, with SessionStart/Setup exceptions',
      'Only in a replay',
    ],
    correct: 1,
  },
  {
    question: 'What should a conversation_reset do?',
    answers: [
      'Declare the query failed',
      'Treat it as compaction only',
      'Reset conversation UI state while retaining the audit trail',
    ],
    correct: 2,
  },
  {
    question: 'What does a logging hook returning {} grant?',
    answers: ['No permission decision', 'Approval for every tool', 'A mutation capability'],
    correct: 0,
  },
] as const;
