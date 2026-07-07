# macOS Distribution

If users see `"Redix" is damaged and can't be opened`, the app is usually not actually damaged. macOS Gatekeeper shows this for downloaded apps that are not signed with a Developer ID certificate and notarized by Apple.

## Temporary Internal Workaround

Only use this for trusted internal testing builds:

```bash
xattr -dr com.apple.quarantine /Applications/Redix.app
```

For public distribution, do not ask users to run this. Ship a signed and notarized build instead.

## Required For Public Builds

1. Join the Apple Developer Program.
2. Create or install a `Developer ID Application` certificate.
3. Create an App Store Connect API key for notarization.
4. Build a DMG with signing and notarization enabled.
5. Verify the final `.app` or `.dmg` before sharing.

## Verify Local Signing Setup

```bash
security find-identity -v -p codesigning
```

Look for an identity like:

```text
Developer ID Application: Your Name (TEAMID)
```

## Build

Local unsigned builds still work for development:

```bash
npm run build
npm run build:dmg
```

For a build that other people can open normally, use your Developer ID certificate and Apple notarization credentials. Tauri supports macOS code signing and notarization through its bundler; the project enables hardened runtime and uses `src-tauri/Entitlements.plist`.

For CI, provide signing and notarization secrets through the environment. Common Tauri/Apple inputs include:

```bash
APPLE_CERTIFICATE=...
APPLE_CERTIFICATE_PASSWORD=...
APPLE_API_KEY=...
APPLE_API_ISSUER=...
APPLE_API_KEY_PATH=...
```

If signing locally with an installed certificate, set the signing identity in `src-tauri/tauri.conf.json` under `bundle.macOS.signingIdentity`, or keep it out of source and inject it in CI.

## Manual Notarization Fallback

If the Tauri bundler produces a signed `.app` but does not submit notarization, zip and submit it manually:

```bash
ditto -c -k --keepParent \
  src-tauri/target/release/bundle/macos/Redix.app \
  /tmp/Redix.zip

xcrun notarytool submit /tmp/Redix.zip \
  --key /path/to/AuthKey_XXXXXXXXXX.p8 \
  --key-id YOUR_KEY_ID \
  --issuer YOUR_ISSUER_ID \
  --wait

xcrun stapler staple src-tauri/target/release/bundle/macos/Redix.app
```

Then recreate or distribute the DMG.

## Release Verification

After building, run:

```bash
npm run verify:macos
```

Expected public-release result:

- `codesign --verify` succeeds.
- `spctl --assess` accepts the app.
- `xcrun stapler validate` finds a valid notarization ticket.
- The downloaded app does not require `xattr -dr com.apple.quarantine`.
