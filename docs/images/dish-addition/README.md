# Background dish addition

Captured and visually inspected on Android 15 / API 35, 1080×2400, Russian, default font scale. Screens show the production MealDetailScreen from this PR with a synthetic breakfast: an active addition with the existing nutrition visible, and the retry state after stopping.

The isolated component harness runs in the existing 1.2.9 (22) native shell with the current screen bundle. It does not access meal storage or call an AI provider; its stop/retry callbacks switch sample state. These are native layout checks, not end-to-end recognition verification. App navigation and the actual addition service are covered separately by automated tests with native, storage, and provider adapters.

Full native rebuild, live provider recognition, process-kill recovery, and enlarged-font layout were not verified. Background additions remain session-owned and do not resume after Android terminates the process.

- [Running addition](running.png)
- [Retry state](failed.png)
