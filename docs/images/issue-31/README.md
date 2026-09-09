# Issue 31: contextual estimate confirmations

Verified on Android 15/API 35 emulator-5554, gesture navigation, font scale 1.0, OpenAI Codex / GPT-5.6 Terra / High / web search enabled.

Before source: main c38fc1f. After: same source plus issue #31 changes to chatTools.ts and mealConfirmation.ts. Native test package dev.calodone.pimobilespike retains local version 1.1.1 (6) solely to update the authenticated test installation. This is not the public release version. Native build delta and APK SHA-256 are saved in ignored issue-31-verification artifacts.

## Reproduce
1. Add by text: `A plate of rice, broccoli, green beans, corn and one egg. I do not know the amounts or how much oil was used.`
2. Open its details, scroll down, choose Discuss meal.
3. Send: `Please recalculate this meal using reasonable estimates for the portions and oil. I do not care about those details. Finish logging it and do not ask any more questions.`
4. Before: saved 557 kcal estimate ends with “Web search execution could not be verified.”
5. Update the native app in place, reopen the same chat, repeat the exact request.
6. After: new saved 557 kcal estimate has no search footer. The earlier message remains in history (visible above the new request in after.png).

The pre-fix run also had failed required-search and stale-revision attempts before succeeding; tracked separately in #52. The post-fix run succeeded. No claim that #31 fixes those intermittent attempts.

This is a text/reanalysis variant of the original photo/pending-question reproduction. The original exact pending-question answer is covered by the saved-chat integration regression. The system photo picker did not open during this replay attempt; its cause was not investigated.

## Verification
- Saved-chat integration regression failed before the fix and passed after it.
- TypeScript check passed; complete suite passed 181 tests before four additional search-status cases were added; all six formatter tests then passed separately.
- Requested research limitations remain visible; completed search sources remain linked; research execution/validation unchanged.
- Native release build succeeded; screenshots show real sample-data UI.
- Local evidence includes targeted chat messages and diagnostics, exact request text, native build patch, and APK checksum. No credentials or full database included.
