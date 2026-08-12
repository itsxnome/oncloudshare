# OnCloudShare

Local-first desktop app for sharing **text**, **clipboard** (text & images), and **files** between your PCs — and joining from a **phone browser** with no app install.

- Same Wi‑Fi → LAN (fast — best for multi‑GB files)
- Different networks → Cloudflare tunnel (or a pasted ngrok URL)
- No Discord, WhatsApp, or cloud drive required

**Current version:** [`1.1.0`](https://github.com/itsxnome/oncloudshare/releases/tag/v1.1.0) (Electron + React)

---

## Download (Windows)

Official builds are published on **[GitHub Releases](https://github.com/itsxnome/oncloudshare/releases)**.

| Asset | What it is |
| --- | --- |
| [`OnCloudShare 1.1.0.exe`](https://github.com/itsxnome/oncloudshare/releases/latest) | Portable — run without installing (~84 MB) |
| [`OnCloudShare Setup 1.1.0.exe`](https://github.com/itsxnome/oncloudshare/releases/latest) | NSIS installer (supports auto-update) |

> Only releases **authorized by the project owner** are published here. Prefer downloading from GitHub Releases, not random mirrors.

---

## What’s new in 1.1.0

- **Multi‑GB transfers** — disk-backed streaming (no full-file RAM load), 512 KB binary chunks, pause / resume
- **Unlimited size by default** — set a MB cap in Settings if you want one
- **Lighter Windows build** — `cloudflared` downloads on demand (not bundled)
- **Update banner + installer auto-update** from GitHub Releases
- **Phone** — Attach-first UX, slice-based uploads, reconnect + queue resume after switching apps
- **Optional experimental E2E** — AES-256-GCM chunk encryption when a room PIN is set (desktop peers)
- **Tests** — Vitest coverage for transfer framing, disk assembler, and version compare

---

## Quick start (users)

1. Download the portable or Setup exe from [Releases](https://github.com/itsxnome/oncloudshare/releases/latest).
2. Run **OnCloudShare** on the PC that will host.
3. **Create a room** (optional PIN).
4. On the other PC: **Join** with the room code, or paste the LAN / remote link.
5. Share text, paste clipboard (`Ctrl+Shift+V` or tray), or drag-and-drop files.

### Large files (10 GB+)

Use **LAN / same Wi‑Fi** for big archives, videos, and game folders. Transfers stream to disk and can resume after a pause or reconnect.

Free Cloudflare quick tunnels are fine for smaller remote shares, but they are **not ideal** for sustained 10–40 GB uploads (timeouts / limits). For free global multi‑GB P2P later, the roadmap targets a **Rust + iroh** engine.

### Phone (iOS / Android)

No install. On the host PC, open the room and use **Phone join**:

1. Scan the QR, or open the shown link in Safari / Chrome.
2. Enter name + room code (and PIN if set) → **Join room**.
3. Send text / files; download shared files from the feed.

**Tips**

- Prefer the **remote `trycloudflare.com` link** if your LAN IP looks like `169.254.x.x` (no real Wi‑Fi route).
- On **iPhone**, Safari blocks silent clipboard reads — use the **Paste** sheet and confirm system **Paste**, or long-press → Paste.
- iPhone drag-and-drop can be flaky; **Attach** is the primary and most reliable way to send photos.
- **Keep the share tab open** while uploading. Phone browsers pause WebSockets when you switch apps; OnCloudShare will auto-reconnect and **resume the upload queue** when you return.

### Remote access

1. Create a room as host — tunnel can auto-start (or enable remote access in the room UI / Settings). If the free tunnel drops, the app can regenerate the link when auto-remote is enabled.
2. Share the `https://….trycloudflare.com` URL + room code with the other device.
3. Or paste an existing public tunnel URL that forwards to this app’s local port.

### Firewall

Allow OnCloudShare through Windows Firewall for **Private** networks (ports **47891–47899**).

---

## Features (what works today)

- Create / join rooms with short codes and optional PIN
- LAN discovery (mDNS) with IP:port fallback
- Text sharing + clipboard paste (text **and** images on desktop)
- Disk-backed 512 KB chunk transfers with progress, pause / resume / cancel
- File size defaults to **unlimited** (`0` in Settings)
- History of saved downloads
- System tray + global shortcut `Ctrl+Shift+V`
- Auto Cloudflare tunnel (`cloudflared` on demand)
- Mobile web join page (`/`, `/m`, `/mobile`) with QR
- Phone WebSocket chunk uploads + background reconnect / queue resume
- GitHub Releases update banner; Setup builds can download & install updates
- Optional experimental AES-GCM encryption (desktop, room PIN required)

---

## Build it yourself

### Requirements

- **Node.js** 20+ (LTS recommended)
- **npm**
- Windows for Windows builds (macOS/Linux builders for those targets)
- Git

### Install & run (dev)

```bash
git clone https://github.com/itsxnome/oncloudshare.git
cd oncloudshare
npm install
npm run dev
```

### Production build

```bash
# Windows — installer + portable (cloudflared downloads on demand)
npm run electron:build

# macOS / Linux (run on that OS or in CI)
npm run electron:build:mac
npm run electron:build:linux
```

**Outputs** (under `release/`):

- `OnCloudShare Setup <version>.exe` — installer
- `OnCloudShare <version>.exe` — portable
- `release/win-unpacked/` — unpacked app folder

Close any running OnCloudShare instance before building — Windows may lock the portable exe.

### Useful scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Dev UI + Electron |
| `npm run build` | Vite production bundles only |
| `npm run typecheck` | TypeScript checks |
| `npm test` | Vitest unit tests |
| `npm run electron:build` | Full Windows package |
| `npm run icons` | Regenerate app icons |
| `npm run fetch:cloudflared` | Optionally pre-download `cloudflared` |

---

## Project status

### Goals achieved

- [x] Local-first sharing without third-party chat/cloud drives
- [x] Host / guest rooms with codes + optional PIN
- [x] LAN + optional remote tunnel
- [x] Text, clipboard, and file transfer between PCs
- [x] Transfer UX (progress, pause/resume, history)
- [x] Phone browser join (QR + mobile web UI)
- [x] Packaged Windows installer + portable exe
- [x] GitHub Releases as the official distribution channel
- [x] Disk-backed multi‑GB transfers with resume
- [x] Lighter Windows package (on-demand tunnel helper)
- [x] Update checks + installer auto-update path
- [x] Automated unit tests for core transfer helpers

### Remaining / next

- [ ] Full E2E encryption on mobile + HTTP download path
- [ ] Signed Windows builds (code signing certificate)
- [ ] macOS / Linux official release artifacts on every authorized cut
- [ ] CI workflow: build + attach artifacts when a release is authorized
- [ ] Further iOS paste / drag-drop edge cases

### Longer-term: Rust / iroh architecture

Electron + Node is a solid v1/v1.1, but the long-term goal is to **migrate the core to a Rust architecture** (likely a Rust relay/transfer engine with a thinner desktop shell — e.g. Tauri).

For free global 10–40 GB transfers, a direct P2P transport such as **[iroh](https://www.iroh.computer/)** is the preferred future option. Cloudflare free quick tunnels are convenient for smaller remote shares but are not well suited to sustained transfers at that scale.

**Why Rust later**

- Smaller, faster binaries
- Safer networking / file I/O
- Easier cross-platform packaging
- Cleaner separation: protocol core in Rust, UI on top

That migration is **planned**, not started. Feature work on the current Electron app continues until we cut over.

### Experimental encryption

Settings includes an optional AES-256-GCM chunk-encryption mode. It requires a room PIN and both desktop peers to use the same PIN and a compatible version. Mobile encryption support is not fully enabled yet.

---

## Release policy

1. **Only owner-authorized releases** are published to GitHub Releases.
2. Each authorized release ships Windows binaries (portable + Setup) as release assets.
3. README / version tags stay in sync with the published cut (`vX.Y.Z`).
4. Do not treat unsigned third-party builds as official.

To publish (maintainers):

```bash
# After building release/*.exe and tagging
git tag v1.1.0
git push origin v1.1.0

gh release create v1.1.0 \
  "release/OnCloudShare 1.1.0.exe" \
  "release/OnCloudShare Setup 1.1.0.exe" \
  --title "OnCloudShare v1.1.0" \
  --notes "See README for usage and changelog."
```

---

## License

MIT — see `package.json` / license file when present.
