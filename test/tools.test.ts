import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLessonServer } from '../src/server/tools.js';
import { counters } from '../src/server/hooks.js';
for (const scenario of ['project', 'missing', 'protected'] as const)
  test(`actual MCP transport: ${scenario}`, async () => {
    const c = counters();
    const server = createLessonServer(c, () => {});
    const client = new Client({ name: 'lesson-test', version: '1' });
    try {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await server.instance.connect(b);
      await client.connect(a);
      const protectedCall = scenario === 'protected';
      const result = await client.callTool({
        name: protectedCall ? 'protected_preview' : 'observe_note',
        arguments: protectedCall ? { label: 'lesson-preview' } : { topic: scenario },
      });
      if (scenario === 'project') {
        assert.notEqual(result.isError, true);
        assert.equal(c.handlerCalls, 1);
        assert.ok(JSON.stringify(result).includes('Event Garden'));
      } else {
        assert.equal(result.isError, true);
        assert.equal(c.protectedCalls, protectedCall ? 1 : 0);
        assert.equal(c.handlerFailures, protectedCall ? 0 : 1);
      }
    } finally {
      await client.close();
      await server.instance.close();
    }
  });
