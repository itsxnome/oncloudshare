#!/usr/bin/env bash
set -euo pipefail

# Builds an unsigned IPA suitable for AltStore (AltStore resigns with your Apple ID).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v xcodegen >/dev/null 2>&1; then
  brew install xcodegen
fi

xcodegen generate

SCHEME="OnCloudShare"
CONFIG="Release"
DERIVED="$ROOT/build"
APP_DIR="$DERIVED/Build/Products/$CONFIG-iphoneos/OnCloudShare.app"
IPA_OUT="${1:-$ROOT/build/OnCloudShare.ipa}"

rm -rf "$DERIVED"
mkdir -p "$DERIVED"

xcodebuild \
  -project OnCloudShare.xcodeproj \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  DEVELOPMENT_TEAM="" \
  build

if [[ ! -d "$APP_DIR" ]]; then
  echo "App bundle missing at $APP_DIR" >&2
  exit 1
fi

STAGE="$DERIVED/ipa-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/Payload"
cp -R "$APP_DIR" "$STAGE/Payload/"

(
  cd "$STAGE"
  zip -r -y "$IPA_OUT" Payload >/dev/null
)

echo "IPA ready: $IPA_OUT"
ls -lh "$IPA_OUT"
