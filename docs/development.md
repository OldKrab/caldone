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

## Releases

[Android release CI](../.github/workflows/android-release.yml) uses Node.js 22 and Java 21, validates TypeScript and tests, generates the native Android project, and builds a signed arm64 APK. Version tags (`v*`) publish GitHub releases; manual runs upload workflow artifacts. The workflow verifies the application ID, signing certificate, and APK architecture.

Set the release version once in `mobile/app.json` (`expo.version`) and increase its Android `versionCode`. Settings, diagnostics, and APK naming read that config. The private npm package has no separate release version. Release signing secrets belong in GitHub Actions, never in the repository.

### Release writing

Write each release for the person deciding whether to update CalDone on their phone. Its opening also appears in the in-app update panel: use an engaging, benefit-led headline, one short sentence explaining what gets better, and up to three concrete highlights. Put the most useful change first and make even a small fix meaningful through the situation it improves. For example, a sign-in fix can lead with “A smoother return from sign-in,” followed by what now happens when the user returns from the browser.

Avoid generic “Bug fixes and improvements,” commit-title dumps, implementation jargon, and unsupported claims. Catch attention through relevant detail and warm, direct language. Keep the opening short enough to scan in a phone dialog; place technical details, validation, and additional changes after the user-facing summary. State required migration or installation actions clearly when they apply.

Release titles, headings, and published notes stay in English. Localized in-app controls and operational messages must preserve the same factual meaning. Review the final notes before publication; generated notes are source material, not a substitute for the authored summary.

Before tagging, add `docs/releases/<version>.md` with a single `#` heading of at most 100 characters, a blank line, and the user-facing opening. Place technical details below a `##` heading. Tagged release CI requires this file, uses its heading as the release title, and publishes its body. The updater reads the authored opening and links to the complete notes.

### In-app updates

Update discovery uses the public `OldKrab/caldone` release list without credentials. It checks when the app enters the foreground at most once per eight hours; manual checks have a one-minute tap cooldown and respect GitHub's retry time. It considers the newest compatible stable candidate among the 20 most recent releases. APK transfer starts only after the user taps **Download and install**. There are no scheduled background checks, automatic downloads, or unattended installations.

`caldone-updates` owns private temporary APK storage and Android installer sessions. Every candidate needs the GitHub SHA-256 digest; the native verifier also checks the package ID, pinned release signer, strictly increasing installed `versionCode`, minimum Android SDK, and device ABI. Android performs final package validation. Differently signed development installs cannot use this updater. Incomplete downloads restart only on explicit retry; downloaded APKs and installer state survive process interruption. A lost system confirmation requires a fresh explicit attempt.

**Existing signing limitation:** the CI-pinned certificate (`fac61745…1033b9c`) matches the public React Native template debug keystore. Its private key is public, so the signer cannot prove exclusive CalDone publisher identity. The updater retains it for compatibility with installed releases and restricts downloads to the official GitHub repository with digest verification. Migrating to a private release key needs a separate compatibility decision; do not describe the current key as a secret production identity.

Automatic notices appear once per release on an idle Today screen. Installer handoff waits for capture, drafts, analysis, chat, and data transfer to finish. Android installation-source permission is requested in context and system installation confirmation is always required. Updating the existing application ID preserves its local data and connections; the old application-ID migration remains separate.

For native validation, run `./android/gradlew -p android :caldone-updates:testDebugUnitTest` after prebuild. Release verification must additionally exercise an actual same-signer upgrade with representative local data, installation denial or cancellation, interrupted transfer, and rejection of wrong-package, wrong-signer, incomplete, and downgrade APKs. Keep evidence in `artifacts/`.

## Local files after a source relocation

The native `android/` directory, dependencies, Metro/Expo caches, and build output are generated and ignored. After moving a checkout, restart Metro and regenerate the native project before building; cached native output may contain absolute paths from the previous location. Install dependencies with `npm ci` in the new `mobile/` directory when preparing a clean build.

## Repository conventions

For branch names, commits, release-note language, and public evidence, follow [contribution guidance](../CONTRIBUTING.md). Local build scripts write APKs to the ignored root `artifacts/` directory.

The Android app requires native modules for authentication, background processing, and its widget.

## Assistant keyboard regression

On a running Android build, open a meal → Discuss meal, focus the message field,
and type a short or multiline draft without sending it. Once the keyboard settles:

```sh
cd mobile
node scripts/check-assistant-keyboard.mjs ../artifacts/assistant-keyboard
```

The check compares the native input and Send touch targets with Android's IME
frame, fails if either is covered, and saves a screenshot, hierarchy and measurements.
Use `ADB` or `ANDROID_HOME` to locate adb and `ANDROID_SERIAL` to select a device.
Run with the app in English or Russian, in both gesture and three-button navigation,
at normal and enlarged font sizes. Also dismiss the keyboard and verify that the
composer returns above the app navigation. Keep evidence in ignored `artifacts/`.
