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

## Local files after a source relocation

The native `android/` directory, dependencies, Metro/Expo caches, and build output are generated and ignored. After moving a checkout, restart Metro and regenerate the native project before building; cached native output may contain absolute paths from the previous location. Install dependencies with `npm ci` in the new `mobile/` directory when preparing a clean build.

## Repository conventions

For branch names, commits, release-note language, and public evidence, follow [contribution guidance](../CONTRIBUTING.md). Local build scripts write APKs to the ignored root `artifacts/` directory.

The Android app requires native modules for authentication, background processing, and its widget.
