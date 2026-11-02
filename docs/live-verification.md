# Real SDK verification

Verified locally on **2026-11-02** with the installed SDK **0.3.310**, Node **24.21.0**, a server-side Anthropic key, and API-accessible model **claude-haiku-5-5**. No key is included in this repository. These are observations from five actual API runs, not fixture results or guarantees for every model/runtime.

| Run                      | Pre | Post | Failure callback | PermissionRequest | Stop | Note handler | Handler failures | Hook denials | Host permission denials | Protected handler | Hook lifecycle frames | Partial frames |    Cost USD |
| ------------------------ | --: | ---: | ---------------: | ----------------: | ---: | -----------: | ---------------: | -----------: | ----------------------: | ----------------: | --------------------: | -------------: | ----------: |
| Success, both flags on   |   1 |    1 |                0 |                 0 |    1 |            1 |                0 |            0 |                       0 |                 0 |                     0 |             26 | 0.000420075 |
| Controlled failure       |   1 |    0 |                1 |                 0 |    1 |            1 |                1 |            0 |                       0 |                 0 |                     0 |             23 | 0.000290730 |
| Hook-blocked             |   1 |    0 |                0 |                 0 |    1 |            0 |                0 |            1 |                       0 |                 0 |                     0 |             28 | 0.000299625 |
| Permission denied        |   1 |    0 |                0 |                 1 |    1 |            0 |                0 |            0 |                       1 |                 0 |                     0 |             18 | 0.000284440 |
| Success, hook frames off |   1 |    1 |                0 |                 0 |    1 |            1 |                0 |            0 |                       0 |                 0 |                     0 |             31 | 0.000265475 |

All five received successful SDK final results that accurately explained the observed tool outcome. This does not mean every tool succeeded. SessionStart and Notification callbacks were configured but their observed counts were zero in every run. Lifecycle frame counts were also zero, including with `includeHookEvents:true`; callbacks still executed. We have not established why this runtime emitted no lifecycle frames or startup callback. Do not infer that the flag generally disables callbacks or that these message families cannot occur. The curated replay demonstrates the relevant documented message families separately.

The smoke command asserts note execution/post callback on success, a controlled handler failure on failure, no handler execution after the explicit hook denial, and zero protected handler execution after the host permission denial. It prints selected counters, costs and the final explanation. Live costs and exact message counts can vary.

Replay, unit tests, injected runner tests and browser tests do not prove real API behavior; the checks above supply that separate evidence. Conversely, these five runs do not exercise every possible runtime event. Reset, unknown-message handling and lifecycle-frame presentation are tested with explicit synthetic inputs.
