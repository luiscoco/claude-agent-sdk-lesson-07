import { replayFrames } from '../server/fixtures.js';
import { DEFAULT_CONFIG } from '../shared/lesson.js';
import { applyFrame, initialState } from '../shared/observe.js';
console.log('SCRIPTED LESSON FIXTURES — no SDK query, tool handler or hook callback executes.');
let state = initialState();
for (const frame of replayFrames({ ...DEFAULT_CONFIG, scenario: 'reset' })) {
  state = applyFrame(state, frame);
  console.log(`${frame.sequence}. ${frame.lane} / ${frame.category}: ${frame.title}`);
}
console.log(
  JSON.stringify(
    { resets: state.resets, conversation: state.conversation, final: state.final },
    null,
    2,
  ),
);
