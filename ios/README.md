# OnCloudShare iOS (AltStore)

Native SwiftUI client for OnCloudShare rooms. No separate backend — the app talks
directly to your PC host over LAN or the Cloudflare tunnel using the same WebSocket
protocol as the mobile web page.

## Features

- Join via share link + room code / PIN
- Send text, photos, and files
- Auto-reconnect
- In-app update: downloads the IPA **locally**, then share sheet → **Open in AltStore**
  (never passes GitHub CDN URLs into `altstore://install?url=`)

## Build IPA (macOS)

```bash
cd ios
chmod +x scripts/build-ipa.sh
./scripts/build-ipa.sh
```

Requires Xcode + [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

The IPA is unsigned/`CODE_SIGNING_ALLOWED=NO` so **AltStore** can resign it with your Apple ID.

## GitHub Actions

Workflow: `.github/workflows/ios-ipa.yml`

- Builds on `macos-14` for tag pushes / published releases / manual dispatch
- Uploads `OnCloudShare-<version>.ipa` to the GitHub Release
- Deletes other `.ipa` assets on that release and prunes IPAs from older releases

## Install with AltStore

1. Download the IPA from Releases **or** use **Update** inside the app
2. Share the file → **Open in AltStore** / **AltStore**
3. Trust the developer cert in iOS Settings if prompted
