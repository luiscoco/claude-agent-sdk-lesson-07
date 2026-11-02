import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { VERSION, SCENARIOS } from '../shared/lesson.js';
import { clean } from '../shared/observe.js';
import { ConfigSchema } from './config.js';
import { replayFrames } from './fixtures.js';
import { runLive, type QueryFactory } from './runner.js';
import { PROJECT_ROOT } from './paths.js';
export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 8192) throw new Error();
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
export interface AppOptions {
  liveAvailable?: boolean;
  queryFactory?: QueryFactory;
}
export function createApiHandler(options: AppOptions = {}) {
  let active: AbortController | undefined;
  let finished: Promise<void> | undefined;
  let closing = false;
  const available = () => options.liveAvailable ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const api = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/api/')) return false;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) {
      json(res, 403, { error: 'Use the local application URL.' });
      return true;
    }
    if (req.method === 'GET' && pathname === '/api/meta') {
      json(res, 200, {
        version: VERSION,
        liveAvailable: available(),
        model: process.env.ANTHROPIC_MODEL || 'SDK default',
        scenarios: SCENARIOS,
      });
      return true;
    }
    if (req.method === 'GET' && pathname === '/api/source') {
      json(res, 200, {
        filename: 'src/server/hooks.ts',
        content: await readFile(path.join(PROJECT_ROOT, 'src/server/hooks.ts'), 'utf8'),
      });
      return true;
    }
    if (req.method !== 'POST' || !['/api/replay', '/api/live'].includes(pathname)) {
      json(res, 404, { error: 'Unknown API endpoint.' });
      return true;
    }
    if (closing) {
      json(res, 503, { error: 'The observatory is shutting down.' });
      return true;
    }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      json(res, 403, { error: 'Cross-origin requests are not allowed.' });
      return true;
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      json(res, 415, { error: 'Send application/json.' });
      return true;
    }
    let input: unknown;
    try {
      input = await body(req);
    } catch {
      json(res, 400, { error: 'Provide valid JSON no larger than 8 KB.' });
      return true;
    }
    const parsed = ConfigSchema.safeParse(input);
    if (!parsed.success) {
      json(res, 400, { error: 'Choose a valid scenario and boolean message flags.' });
      return true;
    }
    if (pathname === '/api/replay') {
      json(res, 200, { fixture: true, frames: replayFrames(parsed.data) });
      return true;
    }
    if (parsed.data.scenario === 'reset') {
      json(res, 400, { error: 'Progress/reset is an explicitly labeled replay scenario.' });
      return true;
    }
    if (!available()) {
      json(res, 409, {
        error: 'Live runs require your server-side ANTHROPIC_API_KEY. Replay needs no key.',
      });
      return true;
    }
    if (active) {
      json(res, 409, { error: 'A live run is already active. Stop it before starting another.' });
      return true;
    }
    const controller = new AbortController();
    active = controller;
    let release!: () => void;
    const completion = new Promise<void>((resolve) => {
      release = resolve;
    });
    finished = completion;
    const disconnect = () => controller.abort();
    res.on('close', disconnect);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = (event: unknown) => {
      if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': waiting\n\n');
    }, 10000);
    try {
      const report = await runLive(
        parsed.data,
        controller.signal,
        (frame) => send({ kind: 'frame', frame }),
        options.queryFactory,
      );
      send({ kind: 'report', report });
      send({ kind: 'done', status: report.sdkOk ? 'success' : 'error' });
    } catch (error) {
      send({
        kind: 'error',
        message: controller.signal.aborted
          ? 'The live run was cancelled. No final report means execution counts are unknown.'
          : clean(error instanceof Error ? error.message : 'The live run failed.'),
      });
      send({ kind: 'done', status: controller.signal.aborted ? 'cancelled' : 'error' });
    } finally {
      clearInterval(heartbeat);
      res.removeListener('close', disconnect);
      controller.abort();
      active = undefined;
      res.end();
      release();
      if (finished === completion) finished = undefined;
    }
    return true;
  };
  return Object.assign(api, {
    async dispose() {
      closing = true;
      active?.abort();
      await finished;
    },
  });
}
