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
        "Full phone-hosted Cloudflare / remote tunnel",
        "Stronger multi-GB resume on iOS host",
        "LAN device picker with one-tap join",
        "Optional end-to-end encryption on iOS",
        "Rust / iroh engine for free global multi-GB P2P",
      ],
      upcoming: true
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
