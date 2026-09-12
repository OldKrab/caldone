# Manual editor title and addition replay

Captured on 2026-09-12 using the accelerated Android 15/API 35 emulator at 1080×2400. Each image is an unedited Android screen capture and was visually inspected.

The full production app JavaScript was built from main `2078238` plus this PR's title change and embedded in the retained test installation's native shell, `dev.calodone.pimobilespike` version 1.1.1 (6). This exercised real navigation, SQLite persistence, and the configured AI provider with synthetic food data. It was not a component harness or a new release APK build. The original APK was backed up before installation.

## Manual editing

- [English, default text size](manual-editor-en.png): the editor retains the **Edit manually** wording from the menu.
- [Russian, 150% text size](manual-editor-ru-150.png): the complete **Изменить вручную** title and Save action remain readable. Russian was also inspected at default text size.
- [Russian, 150% text size with the keyboard](manual-editor-ru-150-keyboard.png): Save remains reachable while editing the meal name.
- Created `Manual check 56` with cooked white rice, 100 g, 130 kcal, P2/C28/F0. Added water, 250 g, explicitly entering zero for calories and all macros. Manual saving retained those values and the 130 kcal total.

## Addition replay: unresolved failure

1. From that record, used **Add food or drink → Describe meal** with `100 g pulled beef` in the English UI.
2. Capture returned immediately to the meal while recognition continued. Returned to Today, then changed the app language to Russian in Settings before answering the resulting clarification.
3. The provisional total was 340 kcal, P28/C28/F12. The assistant asked in English whether the beef was plain or mixed with BBQ sauce.
4. Selected **Plain or lightly seasoned** and submitted the answer in the Russian UI.
5. The completed record contained the original English rice and water, additional Russian rice and water entries, and 210 kcal of beef. The total became 470 kcal, P30/C56/F12.
6. Force-stopped and relaunched the app. [The duplicates and 470 kcal total persisted](duplicated-after-restart.png).

This was observed once. The role of the language change has not been isolated. The exact provider response and clarification request were not captured, so the underlying cause remains undiagnosed. Existing deterministic addition tests pass, but this live replay does not establish that the complete addition/clarification flow is correct. Issue #56 remains open with this evidence; manual Save is intentionally a manual operation.

TypeScript and all 215 tests passed. A fresh native build, release upgrade, and a repeat of the clarification case without switching languages remain unverified. APKs, bundle checksums, UI dumps, and test output are retained in ignored local artifacts.
