import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runLive } from '../server/runner.js';
import { clean } from '../shared/observe.js';
import { DEFAULT_CONFIG, type Config } from '../shared/lesson.js';
if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) throw new Error('Configure your own server-side key.');
console.log('REAL SDK CHECKS — billable model calls, at most $0.25 estimated budget per query.');
const cases: Config[] = process.argv.includes('--all')
  ? [
      DEFAULT_CONFIG,
      { ...DEFAULT_CONFIG, scenario: 'failure' },
      { ...DEFAULT_CONFIG, scenario: 'blocked' },
      { ...DEFAULT_CONFIG, scenario: 'permission' },
      { ...DEFAULT_CONFIG, includeHookEvents: false },
    ]
  : [DEFAULT_CONFIG];
for (const config of cases) {
  try {
    const report = await runLive(config, new AbortController().signal, () => {});
    assert.equal(report.sdkOk, true);
    if (config.scenario === 'success') {
      assert.ok(report.counters.handlerCalls >= 1);
      assert.ok(report.counters.callbacks.PostToolUse >= 1);
    }
    if (config.scenario === 'failure') assert.ok(report.counters.handlerFailures >= 1);
    if (config.scenario === 'blocked') {
      assert.ok(report.counters.hookDenials >= 1);
      assert.equal(report.counters.handlerCalls, 0);
    }
    if (config.scenario === 'permission') {
      assert.ok(report.counters.permissionDecisions >= 1);
      assert.equal(report.counters.protectedCalls, 0);
    }
    console.log(JSON.stringify({ config, verified: true, report }));
  } catch (error) {
    console.log(
      JSON.stringify({
        config,
        verified: false,
        error: clean(error instanceof Error ? error.message : 'Live check failed.'),
      }),
    );
    process.exitCode = 1;
  }
}
