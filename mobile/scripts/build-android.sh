#!/usr/bin/env bash
# Local standalone Android build. Expo config owns the app identity and version.
# This uses the generated development signing key, never production credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./app.json').expo.version")
npx expo prebuild --platform android --no-install
./android/gradlew -p android :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a --console=plain --max-workers=2
mkdir -p ../artifacts
cp android/app/build/outputs/apk/release/app-release.apk "../artifacts/caldone-${version}-arm64.apk"
printf '%s\n' "Built artifacts/caldone-${version}-arm64.apk (CalDone update)"
