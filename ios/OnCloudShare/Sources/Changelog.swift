import Foundation

struct ChangelogEntry: Identifiable {
  let id = UUID()
  let version: String
  let date: String
  let title: String
  let items: [String]
  let upcoming: Bool
}

enum Changelog {
  static let entries: [ChangelogEntry] = [
    ChangelogEntry(
      version: "Next",
      date: "Planned",
      title: "Coming soon",
      items: [
        "Cloudflare-style tunnels on iPhone (when possible without a helper binary)",
        "Stronger multi-GB resume on iOS host",
        "LAN device picker with one-tap join",
        "Optional end-to-end encryption on iOS",
        "Rust / iroh engine for free global multi-GB P2P",
      ],
      upcoming: true
    ),
    ChangelogEntry(
      version: "1.3.0",
      date: "2026-08-21",
      title: "Save, copy, paste & drop",
      items: [
        "Copy button on text items (and drag text on iPad)",
        "Save images/videos to Photos · Download other files · Share sheet",
        "Paste clipboard (text or image) into the room",
        "Drop files / photos onto the room (iPad)",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.9",
      date: "2026-08-21",
      title: "Dismiss keyboard on tap outside",
      items: [
        "Tap outside a text field (or scroll) to close the keyboard",
        "Keyboard Done button for PIN / number fields",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.8",
      date: "2026-08-21",
      title: "Short links that actually work",
      items: [
        "Short links via TinyURL (is.gd was blocked on many networks)",
        "Big “TYPE THIS IN CHROME” label + Retry if shortening fails",
        "Fixed encoding so ?code= room links shorten correctly",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.7",
      date: "2026-08-21",
      title: "Short share links",
      items: [
        "Auto short link (is.gd / v.gd) for public rooms — easier to type and send",
        "Copy short / Copy full buttons + QR uses the short link when available",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.6",
      date: "2026-08-21",
      title: "QR toggle + fix public file downloads",
      items: [
        "Show / Hide QR on the host screen",
        "Browser downloads files over WebSocket (avoids loca.lt Bad Gateway on /files)",
        "More public-tunnel bridges for HTTP fallbacks",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.5",
      date: "2026-08-21",
      title: "Browser join for iPhone-hosted rooms",
      items: [
        "PC/phone Chrome can join an iPhone-hosted public room (no desktop app required)",
        "Auto-join from share link ?code=",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.4",
      date: "2026-08-21",
      title: "Keep hosting alive in background",
      items: [
        "Fix DefunctConnection when switching to WhatsApp — silent keep-alive + auto-recover",
        "Don't kill the room on background listener death",
        "Avoid accidental double public-tunnel start",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.3",
      date: "2026-08-21",
      title: "Public join clarity",
      items: [
        "Landing page after loca.lt Continue (Chrome can't live-join alone)",
        "Join timeout instead of endless Connecting…",
        "Stronger public tunnel bridges + clearer host tips",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.2",
      date: "2026-08-21",
      title: "Public rooms + QR on iPhone",
      items: [
        "Public room toggle — temporary internet link (loca.lt tunnel)",
        "QR code for public or LAN join links",
        "Copy public link / regenerate / retry",
        "Bypass header so apps can join loca.lt tunnels cleanly",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.1",
      date: "2026-08-21",
      title: "Create room on iPhone",
      items: [
        "Create room on iPhone (LAN WebSocket host + Bonjour)",
        "Debug log viewer with Copy all",
        "Changelog screen (past + upcoming)",
        "Real app icon (fixes blank home-screen icon)",
        "Check for updates button",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.2.0",
      date: "2026-08-21",
      title: "iOS AltStore + Windows stability",
      items: [
        "Native SwiftUI iOS app for AltStore",
        "In-app IPA update (download locally → Open in AltStore)",
        "Windows single-instance / visible window fix",
        "Start with Windows (installed Setup)",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.1.0",
      date: "2026-08-13",
      title: "Multi-GB transfers",
      items: [
        "Disk-backed streaming transfers (no full-file RAM load)",
        "512 KB binary WebSocket chunks + resume",
        "Unlimited file size by default",
        "Lighter Windows build (cloudflared on demand)",
        "Desktop update banner + installer auto-update",
        "Phone reconnect + upload queue resume",
      ],
      upcoming: false
    ),
    ChangelogEntry(
      version: "1.0.0",
      date: "2026-08-12",
      title: "First public release",
      items: [
        "PC rooms with codes + optional PIN",
        "LAN discovery + Cloudflare remote links",
        "Text, clipboard, and file sharing",
        "Mobile web join page + QR",
        "Windows portable + Setup builds on GitHub Releases",
      ],
      upcoming: false
    ),
  ]
}
