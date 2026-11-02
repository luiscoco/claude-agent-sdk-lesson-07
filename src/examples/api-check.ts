import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { VERSION } from '../shared/lesson.js';
const directory = path.dirname(
  fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk')),
);
const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
if (pkg.version !== VERSION) throw new Error('Unexpected SDK version.');
console.log(
  `Installed SDK ${VERSION}. Hook matcher objects, callback types and message options compile against its declarations. conversation_reset is a top-level message type.`,
);
