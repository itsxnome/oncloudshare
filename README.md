# OnCloudShare

Local-first desktop app for sharing **text**, **clipboard** (text & images), and **files** between your PCs — and joining from a **phone browser** with no app install.

- Same Wi‑Fi → LAN (fast)
- Different networks → Cloudflare tunnel (or a pasted ngrok URL)
- No Discord, WhatsApp, or cloud drive required

**Current version:** `1.0.0` (Electron + React)

---

## Download (Windows)

Official builds are published on **[GitHub Releases](https://github.com/itsxnome/oncloudshare/releases)**.

| Asset | What it is |
| --- | --- |
| `OnCloudShare 1.0.0.exe` | Portable — run without installing |
| `OnCloudShare Setup 1.0.0.exe` | NSIS installer |

> Only releases **authorized by the project owner** are published here. Prefer downloading from GitHub Releases, not random mirrors.

---

## Quick start (users)

1. Download the portable or Setup exe from [Releases](https://github.com/itsxnome/oncloudshare/releases).
2. Run **OnCloudShare** on the PC that will host.
3. **Create a room** (optional PIN).
4. On the other PC: **Join** with the room code, or paste the LAN / remote link.
5. Share text, paste clipboard (`Ctrl+Shift+V` or tray), or drag-and-drop files.

### Phone (iOS / Android)

No install. On the host PC, open the room and use **Phone join**:

1. Scan the QR, or open the shown link in Safari / Chrome.
2. Enter name + room code (and PIN if set) → **Join room**.
3. Send text / files; download shared files from the feed.

**Tips**

- Prefer the **remote `trycloudflare.com` link** if your LAN IP looks like `169.254.x.x` (no real Wi‑Fi route).
- On **iPhone**, Safari blocks silent clipboard reads — use the **Paste** sheet and confirm system **Paste**, or long-press → Paste.
- iPhone drag-and-drop can be flaky; **Attach** is the most reliable way to send photos.

### Remote access

1. Create a room as host — tunnel can auto-start (or enable remote access in the room UI / Settings).
2. Share the `https://….trycloudflare.com` URL + room code with the other device.
3. Or paste an existing public tunnel URL that forwards to this app’s local port.

### Firewall

Allow OnCloudShare through Windows Firewall for **Private** networks (ports **47891–47899**).

---

## Features (what works today)

- Create / join rooms with short codes and optional PIN
- LAN discovery (mDNS) with IP:port fallback
- Text sharing + clipboard paste (text **and** images on desktop)
- Chunked file transfer with progress, pause / resume / cancel
- History of saved downloads
- System tray + global shortcut `Ctrl+Shift+V`
- Auto Cloudflare tunnel (`cloudflared`) for remote joins
- Mobile web join page (`/`, `/m`, `/mobile`) with QR
- Phone upload via WebSocket chunks (more reliable than multipart on iOS)

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
# Windows — installer + portable (fetches cloudflared + icons)
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
| `npm run electron:build` | Full Windows package |
| `npm run icons` | Regenerate app icons |
| `npm run fetch:cloudflared` | Download bundled `cloudflared` |

---

## Project status

### Goals achieved (v1)

- [x] Local-first sharing without third-party chat/cloud drives
- [x] Host / guest rooms with codes + optional PIN
- [x] LAN + optional remote tunnel
- [x] Text, clipboard, and file transfer between PCs
- [x] Transfer UX (progress, pause/resume, history)
- [x] Phone browser join (QR + mobile web UI)
- [x] Packaged Windows installer + portable exe
- [x] GitHub Releases as the official distribution channel

### Remaining / next

- [ ] Polish mobile paste / drag-drop edge cases across iOS versions
- [ ] Stronger reconnect / offline handling for tunnels
- [ ] Auto-update from GitHub Releases
- [ ] Signed Windows builds (code signing certificate)
- [ ] macOS / Linux official release artifacts on every authorized cut
- [ ] End-to-end encryption options for room payloads
- [ ] CI workflow: build + attach artifacts when a release is authorized

### Longer-term: Rust architecture

Electron + Node is a solid v1, but the long-term goal is to **migrate the core to a Rust architecture** (likely a Rust relay/transfer engine with a thinner desktop shell — e.g. Tauri or a custom UI).

**Why**

- Smaller, faster binaries
- Safer networking / file I/O
- Easier cross-platform packaging
- Cleaner separation: protocol core in Rust, UI on top

That migration is **planned**, not started. Feature work on the current Electron app continues until we cut over.

---

## Release policy

1. **Only owner-authorized releases** are published to GitHub Releases.
2. Each authorized release ships Windows binaries (portable + Setup) as release assets.
3. README / version tags stay in sync with the published cut (`vX.Y.Z`).
4. Do not treat unsigned third-party builds as official.

To publish (maintainers):

```bash
# After building release/*.exe and tagging
git tag v1.0.0
git push origin v1.0.0

gh release create v1.0.0 \
  "release/OnCloudShare 1.0.0.exe" \
  "release/OnCloudShare Setup 1.0.0.exe" \
  --title "OnCloudShare v1.0.0" \
  --notes "See README for usage and changelog."
```

---

## License

MIT — see `package.json` / license file when present.
