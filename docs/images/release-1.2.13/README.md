# Android component review for 1.2.13

Captured on Android 15 / API 35 with Russian copy and font scale 1.3. The images show the production `HomeScreen` and `AppDialog` from the 1.2.13 source, rendered by an ignored component harness with a synthetic meal and inert external actions. The native runtime is the compatible 1.2.12-preview.2 universal APK with the harness bundle substituted.

- [No estimate](no-estimate.png): the saved record has neither an estimate nor an open question.
- [Update notice](update-notice.png): the short message and Close action are visible; `check-app-dialog.mjs` confirms that the message fits without scrolling.

These are actual, inspected Android captures. They do not verify full application navigation, AI processing, update discovery over HTTP, or an installation of the final 1.2.13 release APK.
