# Notification denial regression

Sample-data screenshots from the Android 35 x86_64 emulator on 2026-09-09.

- `before.png`: main 554e931 asks for notification permission again when a meal is submitted after denial.
- `after.png`: main 554e931 plus the #28 fix returns to the journal and analyzes the meal without another prompt.

Both APKs used the existing test application ID and manifest version 1.1.1 (6) for an in-place emulator update. Their source is the current main revision above, not the old 1.1.1 release. The keyboard was open when Analyze meal was tapped in both cases. The visible diary contains synthetic E2E meals.
