# CalDone project rules

## Local environment

- When present, read [AGENTS.local.md](AGENTS.local.md) for this machine's Android emulator and screenshot workflow. That file is local-only and must remain untracked.
- For native UI review, follow [Native UI screenshots](docs/development.md#native-ui-screenshots): prefer an accelerated emulator, confirm Android has finished booting, capture the actual screen, and inspect the images before sharing. Clearly distinguish a synthetic-data component harness from end-to-end app verification.

## App-owned dialogs

- Never use `Alert.alert`, stock Android action dialogs, or other default platform UI for app-owned menus, confirmations, notices, and errors.
- Use `AnchoredMenu` for three-dot/header overflow menus. The menu opens beside its trigger and does not dim the screen.
- Use `AppDialog` for confirmations, notices, errors, and bottom actions that do not have an anchored trigger.
- OS-owned permission, authentication, camera, photo-picker, and share UI is allowed.

## Repository layout

- Production Android app: `mobile/`.
- Product, design, and domain references: `docs/product.md`, `docs/design.md`, and `docs/domain.md`.
- Development and release instructions: `docs/development.md`.
- Local generated evidence belongs in ignored `artifacts/`; public screenshots belong in `docs/images/`.

## Release writing

- Follow the [release-writing guidance](docs/development.md#release-writing) for every release and its in-app update panel.
- Lead with a specific improvement users will care about. Make the panel interesting to read with a concrete benefit and short highlights; generic changelog text is not sufficient.
- Keep release titles, headings, and published notes in English. Describe only changes actually included in the release.
