# Contributing to CalDone

Start with the [development guide](docs/development.md), [product scope](docs/product.md), and [repository rules](AGENTS.md). The Android application lives in `mobile/`.

## Report a bug

Include the app version, Android version, device model, steps to reproduce, expected behavior, and actual behavior. Add a screenshot when it explains the problem. Review screenshots and diagnostic exports before sharing: remove account identifiers, credentials, and personal meal or conversation content.

## Propose a change

Keep changes focused. Open an issue before a substantial product or architecture change. Use a branch prefixed with `shushakov/`, follow the existing commit style, and include a ticket key when one is in scope. Write release notes in English.

From `mobile/`, run:

```sh
npm run check
npm test
```

Explain what changed and how you checked it. For interface changes, include current Android screenshots and state what still needs device verification. Changes to native modules or Expo config plugins also need a native build. Follow the app-owned dialog rules in `AGENTS.md`.

Keep APKs, local test evidence, diagnostic exports, credentials, and generated native output out of Git. Public screenshots should come from a current Android build, use sample data, and record the build version.
