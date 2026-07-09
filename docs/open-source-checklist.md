# Open Source Publishing Checklist

Use this checklist before publishing Redix on GitHub.

## Before First Push

- [x] Review `README.md` and replace the screenshot placeholder with real screenshots.
- [x] Decide the public repository URL: `https://github.com/qIsaac/Redix`.
- [x] Add `repository`, `bugs`, and `homepage` fields to `package.json` after the GitHub repo exists.
- [ ] Confirm no local connection data, screenshots with production keys, `.env` files, certificates, or notarization keys are committed.
- [ ] Run:

```bash
npm run check
git diff --check
```

## GitHub Repository Settings

- [ ] Enable private vulnerability reporting if available.
- [ ] Enable Dependabot alerts.
- [ ] Enable branch protection for `main`.
- [ ] Require the `CI` workflow before merging pull requests.
- [ ] Add repository topics, for example: `redis`, `tauri`, `react`, `typescript`, `rust`, `desktop-app`.

## Release Preparation

- [ ] Update the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- [ ] Build local artifacts:

```bash
npm run build
npm run build:dmg
```

- [ ] For public macOS releases, sign and notarize the app. See `docs/macos-distribution.md`.
- [ ] Verify release artifacts:

```bash
npm run verify:macos
```

## After Publishing

- [ ] Create an initial GitHub release with release notes.
- [ ] Add screenshots or demo GIFs to the README.
- [ ] Open tracking issues for roadmap items.
- [ ] Verify a clean clone can run `npm ci` and `npm run dev`.
