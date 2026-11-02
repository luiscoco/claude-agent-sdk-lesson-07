import './style.css';
import './course-theme.css';
import './course-theme.js';
import { renderMarkdown } from './markdown.js';
import {
  DEFAULT_CONFIG,
  SCENARIOS,
  GUIDE,
  QUIZ,
  VERSION,
  type Config,
  type Frame,
  type Report,
} from '../shared/lesson.js';
import { initialState, applyFrame } from '../shared/observe.js';
import { createEventParser } from '../shared/sse.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector('#app')!.innerHTML = `
<header class="top"><a class="brand" href="/">◉ <span>AGENT LABS / 07</span></a><span>TypeScript · SDK ${VERSION}</span><a href="https://github.com/luiscoco/claude-agent-sdk-lesson-07">View source ↗</a></header>
<main><section class="hero"><div><p class="eyebrow">LESSON 7 / MESSAGES AND HOOKS</p><h1>Read the stream.<br><em>Understand the moment.</em></h1><p class="intro">An observatory for agent messages, host callbacks and tool outcomes. Follow one event at a time, then test the same ideas with a real SDK query.</p></div><div class="hero-art" aria-hidden="true"><span>01 MESSAGE</span><b>↓</b><span>02 HOOK</span><b>↓</b><span>03 OUTCOME</span></div></section>
<nav class="tabs" aria-label="Lesson views"><button data-tab="lab" aria-selected="true">01 Observatory</button><button data-tab="guide">02 Field guide</button><button data-tab="quiz">03 Knowledge check</button></nav>
<section id="lab" class="view"><div class="workspace"><aside class="panel controls"><p class="eyebrow">DESIGN YOUR OBSERVATION</p><label>Run mode<select id="mode"><option value="replay">Replay · no API key</option><option value="live">Live · real SDK query</option></select></label><label>Scenario<select id="scenario">${Object.entries(
  SCENARIOS,
)
  .map(([id, s]) => `<option value="${id}">${s.title}</option>`)
  .join(
    '',
  )}</select></label><p id="scenario-help" class="muted"></p><label class="check"><input type="checkbox" id="hooks" checked> includeHookEvents</label><label class="check"><input type="checkbox" id="partials" checked> includePartialMessages</label><p id="key" class="muted">Checking local configuration…</p><button id="run" class="primary">Load replay</button><div class="actions"><button id="play">Play</button><button id="pause">Pause</button><button id="next">Next event</button><button id="stop" disabled>Stop live</button></div><p id="position" class="muted">No events loaded</p><hr><p><strong>Three separate observations</strong></p><p class="muted">SDK lifecycle frames, host hook callbacks and tool handler execution each have their own evidence. A hook ID is not a tool-use ID.</p><button id="export">Export observed trace ↓</button></aside>
<div class="observation"><div class="notice" id="notice" role="status">Replay uses scripted SDK-shaped fixtures. It executes no query, hook or tool.</div><div class="metrics"><div><b id="messages">0</b><span>SDK / fixture frames</span></div><div><b id="callbacks">0</b><span>Callback rows</span></div><div><b id="resets">0</b><span>Conversation resets</span></div></div>
<section class="panel"><div class="section-head"><h2>Conversation window</h2><span id="identity" class="tag">No session</span></div><p id="progress" class="progress">No task progress observed.</p><div id="conversation" class="conversation"><p class="muted">Load a scenario to begin.</p></div><details><summary>Provisional streaming draft (separate from completed blocks)</summary><pre id="draft">No text deltas.</pre></details><div class="outcome"><p class="eyebrow">FINAL TURN OUTCOME</p><div id="final">Awaiting a result message.</div></div></section>
<section class="panel"><h2>Execution evidence</h2><p id="evidence" class="muted">Replay rows illustrate an ordering; actual executions: not applicable.</p></section>
<section class="panel"><div class="section-head"><h2>Event audit</h2><label>Filter lane<select id="filter"><option value="all">All lanes</option>${['sdk', 'callback', 'policy', 'handler', 'host'].map((x) => `<option>${x}</option>`).join('')}</select></label></div><p class="muted">Latest 200 normalized observations. Filtering never changes the conversation or final result.</p><div id="events" class="events"></div></section></div></div></section>
<section id="guide" class="view" hidden><div class="guide-grid">${GUIDE.map((x) => `<article class="panel"><p class="eyebrow">${x.group}</p><h2>${x.name}</h2><p>${x.text}</p></article>`).join('')}</div><article class="panel"><h2>Read the actual callbacks</h2><p>SDK 0.3.310 requires matcher objects containing callback arrays. Logging returns no approval. The blocked scenario adds an explicit deny decision.</p><details id="source-detail"><summary>Open src/server/hooks.ts</summary><pre id="source">Loading…</pre></details><p class="muted">Observed live behavior: configured SessionStart and Notification callbacks were not invoked in the five verification runs; no hook lifecycle frames were emitted in those runs, even with includeHookEvents enabled. The replay illustrates those documented families without claiming they occurred live.</p></article></section>
<section id="quiz" class="view" hidden><div class="quiz-wrap"><p class="eyebrow">CHECK YOUR MENTAL MODEL</p><h2>Can you explain the evidence?</h2>${QUIZ.map((q, i) => `<fieldset class="panel"><legend>${i + 1}. ${q.question}</legend>${q.answers.map((a, j) => `<label class="check"><input type="radio" name="q${i}" value="${j}">${a}</label>`).join('')}</fieldset>`).join('')}<button id="grade" class="primary">Check answers</button><p id="score" role="status"></p></div></section>
<footer>Message & Hook Observatory · Lesson 7 · Built for learning, one event at a time.</footer></main>`;
let state = initialState(),
  frames: Frame[] = [],
  cursor = 0,
  timer: ReturnType<typeof setInterval> | undefined,
  controller: AbortController | undefined,
  report: Report | undefined,
  submitted: Config = { ...DEFAULT_CONFIG },
  origin = 'replay',
  renderedFinal: string | undefined;
const mode = () => $<HTMLSelectElement>('mode').value;
const config = (): Config => ({
  scenario: $<HTMLSelectElement>('scenario').value as Config['scenario'],
  includeHookEvents: $<HTMLInputElement>('hooks').checked,
  includePartialMessages: $<HTMLInputElement>('partials').checked,
});
function notice(text: string) {
  $('notice').textContent = text;
}
// Render model text as Markdown, keeping a plain label at the start of the first paragraph.
function labelled(target: HTMLElement, label: Node, markdown: string) {
  renderMarkdown(target, markdown);
  const first = target.firstElementChild;
  (first?.tagName === 'P' ? first : target).prepend(label);
}
function pause() {
  clearInterval(timer);
  timer = undefined;
}
function render() {
  $('messages').textContent = String(state.messages);
  $('callbacks').textContent = String(state.callbacks);
  $('resets').textContent = String(state.resets);
  $('identity').textContent = state.sessionId ? state.sessionId.slice(0, 18) + '…' : 'No session';
  $('progress').textContent = state.progress || 'No task progress observed.';
  $('conversation').replaceChildren(
    ...state.conversation.map((c) => {
      const assistant = c.role === 'assistant';
      const p = document.createElement(assistant ? 'div' : 'p');
      const b = document.createElement('b');
      b.textContent = c.role + ' · ';
      if (assistant) {
        p.className = 'markdown';
        labelled(p, b, c.text);
      } else p.append(b, document.createTextNode(c.text));
      return p;
    }),
  );
  $('draft').textContent = state.draft || 'No text deltas.';
  const final = state.final
    ? `${state.final.ok ? 'Completed' : 'Unsuccessful'} · ${state.final.text}`
    : 'Awaiting a result message.';
  // Re-render only when the text changes so playback doesn't reset a reader's selection.
  if (final !== renderedFinal) {
    renderedFinal = final;
    // Successful results carry model text; failures list SDK errors and stay plain text.
    if (state.final?.ok)
      labelled($('final'), document.createTextNode('Completed · '), state.final.text);
    else $('final').textContent = final;
    $('final').classList.toggle('markdown', Boolean(state.final?.ok));
  }
  $('position').textContent =
    origin === 'replay'
      ? `${cursor} / ${frames.length} scripted events observed`
      : `${state.events.length} retained live observations`;
  $('evidence').textContent =
    origin === 'replay'
      ? 'Scripted callback rows only. Actual query, hook and handler executions: not applicable.'
      : report
        ? `Actual callbacks: ${Object.entries(report.counters.callbacks)
            .map(([k, v]) => `${k} ${v}`)
            .join(
              ' · ',
            )}. Tool handler calls ${report.counters.handlerCalls}; controlled failures ${report.counters.handlerFailures}; protected calls ${report.counters.protectedCalls}; hook denials ${report.counters.hookDenials}; permission decisions ${report.counters.permissionDecisions}. SDK hook frames ${report.hookFrames}; partial messages ${report.partialMessages}; cost $${report.costUsd.toFixed(6)}.`
        : 'Live execution counts pending a report; counts are unknown until the run completes.';
  const filter = $<HTMLSelectElement>('filter').value;
  $('events').replaceChildren(
    ...state.events
      .filter((f) => filter === 'all' || f.lane === filter)
      .slice()
      .reverse()
      .map((f) => {
        const d = document.createElement('details');
        const s = document.createElement('summary');
        s.textContent = `${String(f.sequence).padStart(2, '0')} · ${f.origin} / ${f.lane} · ${f.title}`;
        const p = document.createElement('p');
        p.textContent = f.detail;
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(
          {
            category: f.category,
            sessionId: f.sessionId,
            toolUseId: f.toolUseId,
            hookId: f.hookId,
            ...f.envelope,
          },
          null,
          2,
        );
        d.append(s, p, pre);
        return d;
      }),
  );
}
function next() {
  if (cursor >= frames.length) {
    pause();
    return;
  }
  state = applyFrame(state, frames[cursor++]!);
  render();
  if (cursor === frames.length) pause();
}
function settings() {
  const live = mode() === 'live';
  const reset =
    $<HTMLSelectElement>('scenario').querySelector<HTMLOptionElement>('option[value="reset"]')!;
  reset.disabled = live;
  if (live && config().scenario === 'reset') $<HTMLSelectElement>('scenario').value = 'success';
  $('scenario-help').textContent = SCENARIOS[config().scenario].description;
  $('run').textContent = live ? 'Run live scenario' : 'Load replay';
  for (const id of ['play', 'pause', 'next']) $<HTMLButtonElement>(id).disabled = live;
}
for (const id of ['mode', 'scenario']) $(id).addEventListener('change', settings);
$('run').onclick = async () => {
  pause();
  state = initialState();
  frames = [];
  cursor = 0;
  report = undefined;
  submitted = config();
  origin = mode();
  render();
  $<HTMLButtonElement>('run').disabled = true;
  try {
    if (origin === 'replay') {
      const r = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitted),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      frames = data.frames;
      notice('SCRIPTED REPLAY · No SDK query, hook callback or tool handler executes.');
      render();
      return;
    }
    controller = new AbortController();
    $<HTMLButtonElement>('stop').disabled = false;
    notice('LIVE SDK · Waiting for actual messages and callbacks. This run uses API credits.');
    const r = await fetch('/api/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitted),
      signal: controller.signal,
    });
    if (!r.ok) throw Error((await r.json()).error);
    const reader = r.body!.getReader(),
      decoder = new TextDecoder();
    let terminal = false;
    let runError = '';
    const parse = createEventParser((raw) => {
      const p = raw as {
        kind: string;
        frame?: Frame;
        report?: Report;
        message?: string;
        status?: string;
      };
      if (p.kind === 'frame' && p.frame) {
        state = applyFrame(state, p.frame);
        render();
      }
      if (p.kind === 'report') {
        report = p.report;
        render();
      }
      if (p.kind === 'error') {
        runError = p.message || 'Unknown live error';
        notice('Run failed: ' + runError);
      }
      if (p.kind === 'done') {
        terminal = true;
        notice(runError ? `LIVE SDK · ${p.status}: ${runError}` : `LIVE SDK · ${p.status}`);
      }
    });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
    }
    parse(decoder.decode());
    if (!terminal) throw Error('Connection ended before a completion event.');
  } catch (e) {
    notice(
      controller?.signal.aborted
        ? 'Live run stopped; host cleanup requested.'
        : 'Run failed: ' + (e instanceof Error ? e.message : 'Unknown error'),
    );
  } finally {
    controller = undefined;
    $<HTMLButtonElement>('run').disabled = false;
    $<HTMLButtonElement>('stop').disabled = true;
  }
};
$('play').onclick = () => {
  pause();
  if (frames.length) timer = setInterval(next, 180);
};
$('pause').onclick = pause;
$('next').onclick = () => {
  pause();
  next();
};
$('stop').onclick = () => controller?.abort();
$('filter').onchange = render;
$('export').onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          mode: origin,
          config: submitted,
          note: 'Selected-field observations only. Fixture rows are scripted, not executions.',
          state,
          report,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = 'lesson-07-observed-trace.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]'))
  button.onclick = () => {
    for (const v of document.querySelectorAll<HTMLElement>('.view'))
      v.hidden = v.id !== button.dataset.tab;
    for (const b of document.querySelectorAll('[data-tab]'))
      b.setAttribute('aria-selected', String(b === button));
  };
$('grade').onclick = () => {
  let score = 0;
  QUIZ.forEach((q, i) => {
    const a = document.querySelector<HTMLInputElement>(`input[name="q${i}"]:checked`);
    if (a && Number(a.value) === q.correct) score++;
  });
  $('score').textContent =
    `${score} / ${QUIZ.length} correct. ${score === QUIZ.length ? 'You can distinguish observations from outcomes.' : 'Review the field guide and try again.'}`;
};
void fetch('/api/meta')
  .then((r) => r.json())
  .then((m) => {
    $('key').textContent = m.liveAvailable
      ? `Live available · ${m.model} · up to $0.25/run`
      : 'Replay ready · configure a server-side API key for live runs.';
  })
  .catch(() => {
    $('key').textContent = 'Could not load local configuration.';
  });
void fetch('/api/source')
  .then((r) => r.json())
  .then((s) => {
    $('source').textContent = s.content;
  })
  .catch(() => {
    $('source').textContent = 'Source unavailable; open src/server/hooks.ts locally.';
  });
settings();
render();
window.addEventListener('pagehide', () => {
  pause();
  controller?.abort();
});
