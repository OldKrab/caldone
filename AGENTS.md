# CalDone

CalDone is an Android food diary with editable nutrition estimates and an AI assistant.

Before a repository-wide audit or cleanup, establish the checkout's branch, uncommitted changes, and relationship to the current remote default branch. State which revision the findings or changes cover.

- Product behavior or scope: read [product guidance](docs/product.md).
- Domain terminology or data concepts: read [domain language](docs/domain.md).
- UI changes: read [design guidance](docs/design.md), including the app-owned [menu and dialog rules](docs/design.md#menus-and-dialogs).
- Assistant runtime changes: read the [runtime decision](docs/adr/0001-pi-agent-for-assistant-runtime.md).
- Setup, testing, builds, or releases: read [development guidance](docs/development.md).
- Before creating a branch, committing, opening a PR, or publishing: read [contribution guidance](CONTRIBUTING.md).

## Release writing

- Follow the [release-writing guidance](docs/development.md#release-writing) for every release and its in-app update panel.
- Lead with a specific improvement users will care about. Make the panel interesting to read with a concrete benefit and short highlights; generic changelog text is not sufficient.
- Keep release titles, headings, and published notes in English. Describe only changes actually included in the release.
