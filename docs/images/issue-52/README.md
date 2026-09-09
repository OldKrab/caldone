# Issue 52: preserve verified research and recover safely

## Build and device
Android 15/API 35 emulator-5554, gesture navigation, font scale 1.0. OpenAI Codex / GPT-5.6 Terra / High, web search enabled. Before source: main 7494689 plus a temporary observer probe. After source: main 7494689 plus this fix, with the probe removed.

The native test package dev.calodone.pimobilespike retains local manifest version 1.1.1 (6) to update the authenticated test installation. This does not identify the source or public release. Full native checkout delta, APK SHA-256, build output, and targeted traces are in ignored artifacts/e2e-2026-09-09/issue-52-verification.

## Exact native replay
1. Existing sample meal: `A plate of rice, broccoli, green beans, corn and one egg. I do not know the amounts or how much oil was used.` Originally estimated at 557 kcal.
2. In its chat send: `Search the web to verify the nutrition for this rice, vegetables and egg meal, then recalculate it using reasonable portions and oil.`
3. Before: three research attempts fail verification; a direct nutrition-edit fallback is rejected. The temporary probe records three HTTP 200 responses with bodies and Content-Type null. The observer skips them without parsing events. Saved nutrition remains unchanged.
4. Install the clean fixed build in place; reopen the same chat and repeat the same request. The assistant repeats the old failure from history without invoking analysis. This is not a new observer failure.
5. Send: `The app has been updated. Please retry the web research and meal recalculation now.`
6. After: get_meal reads revision 15; reanalyze_meal uses requireSearch=true and succeeds. Stored research status is completed with provider-observed sources. The meal remains a 557 kcal estimate. No failed tools in this retry. after.png includes earlier failed prose above the new request; it is retained chat history.

## Diagnosis and regression coverage
- The observer required a text/event-stream header and skipped valid native streams whose header was absent. A deterministic response replay failed with unobserved before the fix and passes with completed search and sources afterward. The original response bytes remain readable by the provider parser.
- The original #31 trace also showed a failed required-search call followed by requireSearch=false. A real tool/processor/repository/provider integration test failed before the fix because that retry saved successfully. It now remains blocked until search evidence is supplied; verified research then saves successfully.
- Failed research preserves saved nutrition but entering/leaving analyzing advances revision twice. Stale revisions remain rejected. The research failure now tells the agent to reread the meal and keep web search required.
- Research requirements from failed tool calls remain binding for the same meal within the user turn; unrelated meals and new user turns are independent. Direct replacement nutrition cannot bypass that requirement. The manual-meal correction fallback also forwards it.
- TypeScript check and all 189 tests passed; the final additional stale-revision assertion passed in the focused integration test. Native release build passed.

## Evidence and remaining scope
before.png shows the failed native sequence; after.png shows the successful retry; sources-overflow.png records the newly visible source-list problem tracked in #54. Search execution is verified; this does not establish that every returned source supports nutrition. The 46-link list mixes nutrition and artwork search results and needs separate provenance/UI work.

Temporary diagnostics contained only status/header-presence/event-type metadata, no headers or credentials, and were removed before the final build. No database migration or revision-protection relaxation is included. The exact original stochastic sequence is retained from #31; its requirement-dropping retry is covered deterministically, while native verification uses the explicit search/retry requests above.
