<p align="center">
  <img src="mobile/assets/caldone-fork-icon.png" width="104" alt="CalDone bent-fork icon">
</p>

# CalDone

A calm food diary for Android. Log a meal with photos or text, get an editable calorie and macro estimate, and clarify the details in conversation.

**[Download for Android](https://github.com/OldKrab/caldone/releases/latest)** · [Release history](https://github.com/OldKrab/caldone/releases) · [Report an issue](https://github.com/OldKrab/caldone/issues)

## What you can do

- Capture or choose meal photos, describe food in text, or enter nutrition manually.
- Review daily calories, protein, carbohydrates, and fat alongside your goals.
- Correct portions, ingredients, nutrition, and meal times yourself or with the assistant.
- Answer clarification questions, inspect assistant changes, and undo supported actions.
- Use English or Russian, the Android capture widget, and configurable notifications and units.
- Export and import your meal history, photos, and conversations.

## Get started

1. Download the **arm64 APK** from [GitHub Releases](https://github.com/OldKrab/caldone/releases/latest) and install it on a compatible Android phone. Android may ask you to allow installation from your browser or file manager.
2. Complete setup and connect your ChatGPT account through the browser. OpenAI Codex is the currently implemented AI provider.
3. Tap **Add meal**, take or choose a photo, or describe the meal. Review the estimate and answer any remaining questions.

Upgrading from 1.1.x? Follow the [data-transfer guide](docs/migrations.md) before removing your old installation.

## Data and limitations

Meal history and photos are stored locally; captured photos do not automatically enter your gallery. Photos and relevant meal or conversation content are sent to the connected AI provider when needed. Credentials use the operating system's secure storage and are excluded from backups.

Nutrition values are AI estimates that you can correct. Analysis requires network access; Android may interrupt background work, and queued processing can resume later. Barcode scanning and health-platform synchronization are not implemented.

## Development

The production app uses Expo, React Native, and TypeScript. A native Android build is required; Expo Go cannot run all app modules.

```sh
cd mobile
npm ci
npm run check
npm test
npm run android
```

See [development and releases](docs/development.md) for prerequisites and APK builds, and [contributing](CONTRIBUTING.md) for changes and bug reports.

| Path | Purpose |
| --- | --- |
| [`mobile/`](mobile/) | Production Android app, native modules, and build tooling |
| [`docs/`](docs/README.md) | Product, design, domain, and development documentation |
| [`.github/`](.github/) | CI, releases, and contribution templates |

## License

[MIT](LICENSE). The original Expo copyright notice is preserved. Dependencies retain their own licenses.
