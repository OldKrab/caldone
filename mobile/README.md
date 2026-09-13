# CalDone Android app

The production CalDone Android app, built with Expo, React Native, and TypeScript. See the [root README](../README.md) for installation and the [development guide](../docs/development.md) for setup, verification, and releases.

## Current flow

1. Connect a ChatGPT account through browser OAuth.
2. Tap **Add meal** to open the camera directly. Gallery and **Describe meal** are secondary actions on the camera screen; manual nutrition entry is available from the description screen.
3. Take or choose photos, or describe the meal in text, then start analysis.
4. Return immediately to the Today screen while CalDone recognizes the complete meal.
5. Answer remaining questions with selectable choices, custom text, or an ordinary chat message. Questions close only when the assistant applies the answer or dismisses an invalid question; unrelated discussion keeps them open. **Not sure** records uncertainty and keeps the estimate approximate.

The Android home-screen widget opens directly into the camera. User-initiated meal analysis acquires an Android foreground service with a quiet notification and a bounded wake lock, allowing processing while other apps are open. WorkManager provides durable recovery after interruption, and returning to the app revisits delayed retries. Requests have a deadline and failures use bounded retries.

Opening a meal exposes its nutrition breakdown, **Fix with AI**, and manual editing for items, portions, meal type, time, calories, and macros. The Today header navigates previous days, and Settings stores optional calorie and macro goals.

After analysis and clarification finish, **Add dish** opens the same camera, gallery, and text flow for an existing meal. The same meal conversation handles the addition. New items and photos are appended while original item values, title, notes, type, and time are protected by the repository. Questions about an added dish remain scoped to that dish, including after restart or backup restore.

Dish additions stay on the capture/description screen until analysis and saving finish. **Stop** or Android Back during analysis keeps the draft available; request failures and concurrent meal changes also retain it for retry. Once submitted, the addition and its input photos are durable and can resume after process interruption. An unsubmitted capture or text draft can still be lost when the process exits.

Captured photos stay in private app storage and never enter the system gallery automatically. They remain attached to the meal so the user and assistant can inspect them later; saving or sharing a photo requires an explicit user action.

Text-only meal research can attach one representative image from a matching search source's Open Graph or Twitter preview metadata. The journal marks it **Web**; meal details show **From web · illustrative** and link to the source. The app stores the image and source URLs separately from user photos, includes them in backups, and excludes artwork from later AI evidence. Loading the remote image needs network access. Missing previews, redirects, failed image loads, and page lookups exceeding three seconds are skipped without failing the meal. Artwork does not trigger an extra model search.

The interface and formatting are localized in English and Russian. Provider authorization and multimodal transport live under `src/ai`; the shared assistant prompt and tools perform nutrition analysis directly. There is no separate meal-analyzer request behind a chat tool.

## Persistent meal conversations

Capture, meal forms, notifications, chat and additions use one primary conversation per meal. Existing primary history is reused; older secondary conversations remain readable and share current meal questions. The assistant reads current records and uses `edit_meal` to save nutrition together with question transitions. Each question has a stable ID and an explicit open, answered or dismissed state. Answers may resolve only part of a form, and unknown answers retain an uncertainty flag. A question can precede the first estimate when the available evidence is insufficient.

The app saves accepted input before contacting the provider and saves completed assistant tool calls before executing them. A meal edit commits its question changes, Undo snapshot and replay receipt in one SQLite transaction. After interruption, completed edits are recovered from their receipts rather than applied twice; an unknown tool outcome requires rereading current data. Closing a screen detaches its observer without cancelling the conversation. Stop cancels further work but does not undo edits already committed. Each provider response has a three-minute deadline; the app rejects late tool output after cancellation or timeout.

Backups preserve question IDs and states and conversation history. Importing a backup never restarts old pending requests. Credentials remain excluded.

## Run and verify

This cannot run in Expo Go because Codex OAuth uses a native localhost callback listener.

```sh
npm ci
npm run check
npm run android
```

No emulator is required. `npm run android` can install a development build on a USB-connected Android phone.

## Current boundary

- OpenAI Codex is the first provider.
- Android controls the exact WorkManager execution time; foreground-service processing still depends on network availability and device power policies. Force-stopping the app ends processing; queued work can resume on the next launch.
- Nutrition estimates currently come from the connected model rather than a verified food database.
- Barcode scanning, a dedicated packaged-food database, and health-platform synchronization are not implemented. App-data import and export are available in Settings.
- The OAuth adapter follows Pi/OpenAI integration behavior that is not documented as a stable general mobile API and may require upstream maintenance.

Camera zoom uses CameraX-exposed lenses and zoom ranges. An ultrawide choice appears only when Android exposes one to third-party apps. Preview and capture review preserve the full frame; capture requests disable the shutter sound. Diagnostics are saved as JSON to a user-selected folder rather than opening a share sheet.

The patched Android camera must build from source (`expo.autolinking.android.buildFromSource` in package.json). Stock precompiled Expo camera binaries omit the lens adapter; the autolinking regression checks this release boundary. Camera diagnostics record exposed lenses, zoom ranges and capability lookup errors without recording images.
