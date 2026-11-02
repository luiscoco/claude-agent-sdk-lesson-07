import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FIXTURE_ROOT } from './paths.js';
import type { Counters } from '../shared/lesson.js';
import type { Emit } from './hooks.js';
export function createLessonServer(counts: Counters, emit: Emit) {
  const server = createSdkMcpServer({
    name: 'message-hook-fixture',
    version: '1.0.0',
    tools: [
      tool(
        'observe_note',
        'Read the fixed Event Garden note. topic missing produces a controlled tool error for the lesson.',
        { topic: z.enum(['project', 'missing']) },
        async ({ topic }) => {
          counts.handlerCalls++;
          if (topic === 'missing') {
            counts.handlerFailures++;
            emit({
              origin: 'live',
              lane: 'handler',
              category: 'handler',
              title: 'Controlled tool failure',
              detail: 'The handler returned isError:true. No file lookup was attempted.',
              envelope: { isError: true },
            });
            return {
              content: [
                {
                  type: 'text',
                  text: 'Controlled fixture failure: the requested note is unavailable. Do not retry.',
                },
              ],
              isError: true,
            };
          }
          const text = await readFile(path.join(FIXTURE_ROOT, 'note.md'), 'utf8');
          emit({
            origin: 'live',
            lane: 'handler',
            category: 'handler',
            title: 'Note handler executed',
            detail: 'Read only the fixed bundled note.',
            envelope: { topic },
          });
          return {
            content: [{ type: 'text', text }],
            structuredContent: { project: 'Event Garden' },
          };
        },
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
      tool(
        'protected_preview',
        'A protected read-only preview requiring host permission. This lesson’s separate host policy denies it.',
        { label: z.literal('lesson-preview') },
        async () => {
          counts.protectedCalls++;
          return {
            content: [
              {
                type: 'text',
                text: 'This protected fixture refuses execution directly. No protected data is exposed.',
              },
            ],
            isError: true,
          };
        },
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
    ],
  });
  return {
    ...server,
    tools: [{ name: 'protected_preview', permission_policy: 'always_ask' as const }],
  };
}
