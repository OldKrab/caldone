# Development

The Android app lives in `mobile/`. It uses Expo, React Native, and TypeScript. Use Node.js 22.18+ and an Android development environment with a compatible JDK and Android SDK; release CI uses Node.js 22 and Java 21.

A **native build is required**. Expo Go cannot run the Codex authentication callback listener.

```sh
cd mobile
npm ci
npm run check
npm run android
```

`npm run android` can install on an emulator or a USB-connected Android device. Run the complete test suite, including nested feature tests:

```bash
npm test
```

To build a local standalone arm64 APK with your Android SDK and JDK configured:

```sh
bash scripts/build-android.sh
```

The APK is written to `artifacts/caldone-<version>-arm64.apk` at the repository root. Local builds use the generated development signing key; builds made on another machine may not update an official installation. GitHub releases use the configured release signing key.

## Native UI screenshots

Use a hardware-accelerated Android emulator or connected device for visual review. On Linux, check access to `/dev/kvm`; if the user belongs to `kvm` but the current session predates that membership, `sg kvm` can start the emulator with the new group. Check the host environment when a sandbox hides devices or blocks ADB sockets. Keep machine-specific SDK paths and AVD names in the ignored `AGENTS.local.md` referenced by root `AGENTS.md`.

Prefer an existing compatible development app with Metro for UI-only changes. Before capturing, run `adb devices -l`, select the intended serial explicitly, and confirm `adb -s SERIAL shell getprop sys.boot_completed` returns `1`. An ADB connection alone does not mean Android's package and window services are ready.

For isolated layout review, a local harness may render the production React Native components with synthetic data and inert external actions. Keep the harness and generated assets in ignored directories, disclose that it is a harness, and do not count its screenshots as verification of navigation, persistence, authentication, or AI processing. Preserve existing emulator data and installations; do not wipe a device to get a screenshot.

Capture the actual Android screen:

```sh
adb -s SERIAL exec-out screencap -p > artifacts/TASK/SCREEN.png
```

Review the captured images before sharing. Include relevant open menus and dialogs, and check localized copy and enlarged text when the change affects them. Restore any changed device settings afterward. Edited images and browser previews must be labeled as mockups, never as native verification.

## Releases

[Android release CI](../.github/workflows/android-release.yml) uses Node.js 22 and Java 21, validates TypeScript and tests, generates the native Android project, and builds a signed arm64 APK. Version tags (`v*`) publish GitHub releases; manual runs upload workflow artifacts. The workflow verifies the application ID, signing certificate, and APK architecture.

Keep `mobile/package.json`, its lockfile, and `mobile/app.json` versions aligned when preparing a release; increase Android `versionCode`. Release notes must be in English. Release signing secrets belong in GitHub Actions, never in the repository.

### Release writing

Write each release for the person deciding whether to update CalDone on their phone. Its opening should also work as the in-app update panel: an engaging, benefit-led headline, one short sentence explaining what gets better, and up to three concrete highlights. Put the most useful change first and make even a small fix meaningful through the situation it improves. For example, a sign-in fix can lead with “A smoother return from sign-in,” followed by what now happens when the user returns from the browser.

Avoid generic “Bug fixes and improvements,” commit-title dumps, implementation jargon, and unsupported claims. Catch attention through relevant detail and warm, direct language. Keep the opening short enough to scan in a phone dialog; place technical details, validation, and any additional changes after the user-facing summary. State required migration or installation actions clearly when they apply.

Release titles, headings, and published notes stay in English. Localized in-app copy must preserve the same factual meaning. Review the final notes before publication; CI-generated notes are source material, not a substitute for this summary.

Before tagging, add `docs/releases/<version>.md` with a single `#` heading (at most 100 characters), a blank line, and the user-facing opening. Place technical details below a `##` heading. Tagged release CI requires this file, uses its heading as the release title, and publishes its body. The updater reads the authored opening and links to the complete notes. Published release content remains English; the updater's controls and operational messages follow the app's English/Russian language setting.

### In-app updates

Update discovery uses the public `OldKrab/caldone` release list without credentials. It checks at foreground entry at most once per eight hours; manual checks have a one-minute tap cooldown and respect GitHub's retry time. It considers the newest compatible stable candidate among the 20 most recent releases. Metadata checks may use any connected network; APK transfers use the current connection only after **Download and install** is tapped. No scheduled background checks, automatic downloads, or unattended installations run.

`caldone-updates` owns private temporary APK storage and Android installer sessions. Every candidate needs the GitHub SHA-256 digest; the native verifier also checks the built package ID, pinned release signer, strictly increasing installed `versionCode`, minimum Android SDK, and device ABI. Android performs final package installation validation. Old application IDs and differently signed development installs cannot use this updater. Incomplete downloads restart only on explicit retry; downloaded APKs and installer state survive process interruption. A lost system confirmation requires a fresh explicit attempt.

**Existing signing limitation:** the CI-pinned certificate (`fac61745…1033b9c`) matches the [public React Native template debug keystore](https://github.com/react-native-community/template/blob/main/template/android/app/debug.keystore), verified during #51. Its private key is public, so the signer cannot prove exclusive CalDone publisher identity. The updater retains it for compatibility with installed releases and restricts downloads to the official GitHub repository with digest verification. Migrating to a private release key needs a separate, explicit compatibility decision; do not describe the current key as a secret production identity.

Automatic notices appear once per release on an idle journal. Installer handoff waits for capture, drafts, analysis, chat, and data transfer to finish. Android installation-source permission is requested in context and system installation confirmation is always required. Updating an existing application ID preserves its local data and connections; the old application-ID migration remains separate.

For native validation run `./android/gradlew -p android :caldone-updates:testDebugUnitTest` after prebuild. Release verification must additionally exercise an actual same-signer upgrade with representative local data, installation denial/cancellation, interrupted transfer, and rejection of wrong-package, wrong-signer, incomplete, and downgrade APKs. Keep evidence in `artifacts/`.

## Local files after a source relocation

The native `android/` directory, dependencies, Metro/Expo caches, and build output are generated and ignored. After moving a checkout, restart Metro and regenerate the native project before building; cached native output may contain absolute paths from the previous location. Install dependencies with `npm ci` in the new `mobile/` directory when preparing a clean build.

## Repository conventions

Use `shushakov/` branch names and follow the existing commit style. Include the ticket key when one is in scope. Keep local APKs, diagnostics, emulator captures, and test exports in the ignored root `artifacts/` directory. Only curated, reviewed documentation images belong in `docs/images/`.

The Android app requires native modules for authentication, background processing, and its widget.


## Agent recovery checks

`npm test` in `mobile/` covers the shared meal agent with the production Pi agent, tool implementations, request encoder, SSE parser and SQLite repositories. The native test adapter replaces Android bridges and external HTTP only. Scripted provider responses check persistence and tool behavior; they do not establish a model's semantic accuracy.

`agentProcessRecovery.test.ts` starts two separate Node processes against a file-backed database. The first exits immediately after a meal edit commits and before the tool result reaches conversation history. The second restores the request from its receipt and checks that input, nutrition edits and Undo actions are not duplicated. Deadline tests also verify that a late provider response cannot execute a mutation.

For model behavior, run representative authorized inputs through the same production agent with live provider HTTP and keep private evidence in ignored `artifacts/`. Include initial photos, disputed identities, discussion without mutation, partial forms, indirect answers, Not sure, additions, search settings and interrupted requests. Model recognition and estimated nutrition can vary; record actual outcomes rather than treating scripted tests as live inference proof. Native component harness screenshots verify layout and interaction only; they are not full-app provider or background-execution evidence.
