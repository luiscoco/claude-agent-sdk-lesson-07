# Classroom walkthrough

Allow 15–20 minutes. Begin with replay; a key is only needed for the optional live comparison.

1. **Tool success:** Load a replay and step through each event. Identify the SDK lane, callback lane and handler lane. Open envelopes and compare `hook_id` with `tool_use_id`. Explain why a lifecycle frame is not proof the tool handler ran.
2. **Flags:** Turn off `includeHookEvents` and reload. Callback fixtures remain while most lifecycle frames disappear. SessionStart is the documented lifecycle-filter exception illustrated by the fixture. Turn off partial messages and compare the draft with completed conversation blocks. Do not append both into a single answer.
3. **Tool failure:** Play the replay. Find the controlled tool failure and the final success result. A final explanation can succeed while reporting failed tool work. Locate the corresponding real callback in `src/server/hooks.ts`.
4. **Hook-blocked call:** Find the explicit `PreToolUse` deny row. Explain why a logger returning `{}` would not have blocked execution. Confirm the handler lane is absent in this scenario.
5. **Permission denied:** Find the `PermissionRequest` logging row and the separate host policy row. Predict the actual protected handler counter before running live.
6. **Progress & reset:** Step until the old conversation is visible. Observe progress without a final result. Step over `conversation_reset` and check that conversation, draft, progress and final clear while the audit remains. The late old-session progress event must stay in the audit without restoring old state. `compact_boundary` must not clear the new conversation. Unknown message families must not crash or invent a final result.
7. **Optional live run:** Configure your own ignored `.env` and run success, failure, blocked or permission. Check actual counters rather than expecting the fixture ordering. A missing SessionStart callback or zero lifecycle frames is an observation, not permission to synthesize live evidence. Stop a live run and distinguish host resource cleanup from the agent's Stop callback.
8. **Export and quiz:** Filter the audit lane, export the trace, and confirm final state is unchanged. The export contains only retained normalized observations. Complete the four questions in the knowledge check.

## Small implementation exercise

Add a display-only counter for `task_progress` without changing final outcome handling. Put the classification in `projectMessage`, keep state updates in `applyFrame`, and write a test showing that progress arriving after a result cannot replace that result. Avoid enabling new tools or expanding permissions for a display exercise.

## Instructor answers

- `result` is the final turn outcome; progress and hook callbacks are independent observations.
- `includeHookEvents:false` does not unregister callbacks.
- Every top-level `conversation_reset` clears conversation-specific display state, even with a future trigger.
- A logging callback returning `{}` grants no permission.
- A `Stop` callback, a result message, disconnect cancellation and `close()` have different meanings.
