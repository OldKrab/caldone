# Assistant keyboard positioning

Android 15/API 35 x86_64 Pixel 6 emulator profile, Gboard, 1080×2400 at 420 dpi; captured 2026-09-09 with synthetic meal data.

- `red-gesture.png`: main d65f206, gesture navigation, input and Send extend 30 physical pixels behind the keyboard.
- `fixed-gestures.png` and `fixed-three-button.png`: main d65f206 plus the #29 fix, normal text size. Both controls are fully visible, with 35 pixels of clearance.
- `fixed-gestures-large.png` and `fixed-three-button-large.png`: same fix, 150% text and a multiline draft. Input has 34 pixels and Send has 35 pixels of clearance.

The local APK retained the test application ID `dev.calodone.pimobilespike` and manifest version 1.1.1 (6) for an in-place upgrade preserving login and sample meals. Its source is the current-main revision above plus this fix, not the old 1.1.1 release.

Run the native regression check using the instructions in [development.md](../../development.md#assistant-keyboard-regression). Physical-device verification of the fix remains pending.
