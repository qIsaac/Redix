# Contributing

Thanks for your interest in Redix.

## Development Setup

```bash
npm ci
npm run dev
```

Before opening a pull request, run:

```bash
npm run check
```

## Pull Request Guidelines

- Keep changes focused and describe the user-visible behavior.
- Include screenshots or short screen recordings for UI changes when possible.
- Avoid committing generated build output, local app data, `.env` files, or connection exports.
- Keep platform-specific behavior documented, especially for macOS signing and notarization.
- For risky Redis behavior, explain safety considerations and error handling.

## Code Style

- Frontend code uses React, TypeScript, and Zustand.
- Backend code uses Rust and Tauri commands.
- Prefer existing store/API/component patterns before adding new abstractions.
- Keep UI controls compact and operational; Redix is a developer tool, not a marketing surface.

## Reporting Bugs

Please include:

- Redix version or commit SHA.
- OS version.
- Redis deployment type: standalone, Sentinel, or Cluster.
- Reproduction steps.
- Expected behavior and actual behavior.
- Screenshots or sanitized logs if useful.

Do not include real passwords, production hostnames, tokens, or sensitive key/value data.
