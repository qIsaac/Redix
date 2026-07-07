#!/usr/bin/env bash
set -euo pipefail

TARGET_PATH="${1:-src-tauri/target/release/bundle/macos/Redix.app}"
FAILED=0
MOUNT_DIR=""

cleanup() {
  if [[ -n "$MOUNT_DIR" ]]; then
    hdiutil detach "$MOUNT_DIR" -quiet || true
  fi
}
trap cleanup EXIT

absolute_path() {
  local path="$1"
  if [[ -d "$path" ]]; then
    echo "$(cd "$(dirname "$path")" && pwd -P)/$(basename "$path")"
  elif [[ -f "$path" ]]; then
    echo "$(cd "$(dirname "$path")" && pwd -P)/$(basename "$path")"
  else
    echo "$path"
  fi
}

verify_app_bundle() {
  local app_path="$1"

  if [[ ! -d "$app_path" ]]; then
    echo "App bundle not found: $app_path" >&2
    FAILED=1
    return
  fi

  app_path="$(absolute_path "$app_path")"

  echo "== Bundle =="
  du -sh "$app_path"

  echo
  echo "== Code signature =="
  if codesign --verify --deep --strict --verbose=2 "$app_path"; then
    codesign -dv --verbose=4 "$app_path" 2>&1 | sed -n '1,16p'
  else
    echo "Code signature verification failed." >&2
    codesign -dv --verbose=4 "$app_path" 2>&1 | sed -n '1,20p' || true
    FAILED=1
  fi

  echo
  echo "== Gatekeeper assessment =="
  if spctl --assess --type execute --verbose=4 "$app_path"; then
    true
  else
    echo "Gatekeeper assessment failed. The app is probably unsigned or not notarized." >&2
    FAILED=1
  fi

  echo
  echo "== Notarization staple =="
  if xcrun stapler validate "$app_path"; then
    true
  else
    echo "No valid notarization ticket was found on this app bundle." >&2
    FAILED=1
  fi

  echo
  echo "== Quarantine attribute =="
  if xattr -p com.apple.quarantine "$app_path" >/dev/null 2>&1; then
    xattr -p com.apple.quarantine "$app_path"
  else
    echo "No quarantine attribute on this local bundle."
  fi
}

verify_dmg() {
  local dmg_path="$1"

  if [[ ! -f "$dmg_path" ]]; then
    echo "DMG not found: $dmg_path" >&2
    FAILED=1
    return
  fi

  dmg_path="$(absolute_path "$dmg_path")"

  echo "== DMG =="
  du -sh "$dmg_path"

  echo
  echo "== DMG code signature =="
  if codesign --verify --verbose=2 "$dmg_path"; then
    codesign -dv --verbose=4 "$dmg_path" 2>&1 | sed -n '1,16p'
  else
    echo "DMG code signature verification failed." >&2
    codesign -dv --verbose=4 "$dmg_path" 2>&1 | sed -n '1,20p' || true
    FAILED=1
  fi

  echo
  echo "== DMG Gatekeeper assessment =="
  if spctl --assess --type open --verbose=4 "$dmg_path"; then
    true
  else
    echo "Gatekeeper assessment failed for DMG." >&2
    FAILED=1
  fi

  echo
  echo "== DMG notarization staple =="
  if xcrun stapler validate "$dmg_path"; then
    true
  else
    echo "No valid notarization ticket was found on this DMG." >&2
    FAILED=1
  fi

  echo
  echo "== Mount DMG =="
  MOUNT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/redix-dmg.XXXXXX")"
  rmdir "$MOUNT_DIR"
  hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$MOUNT_DIR" -quiet
  local app_path
  app_path="$(find "$MOUNT_DIR" -maxdepth 1 -name '*.app' -type d -print -quit)"
  if [[ -z "$app_path" ]]; then
    echo "No .app bundle found in DMG." >&2
    FAILED=1
    return
  fi
  verify_app_bundle "$app_path"
}

case "$TARGET_PATH" in
  *.dmg)
    verify_dmg "$TARGET_PATH"
    ;;
  *.app | *)
    verify_app_bundle "$TARGET_PATH"
    ;;
esac

if [[ "$FAILED" -ne 0 ]]; then
  echo
  echo "Release verification failed." >&2
fi

exit "$FAILED"
