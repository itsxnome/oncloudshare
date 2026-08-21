import SwiftUI
import PhotosUI

struct RootView: View {
  @EnvironmentObject private var model: AppModel
  @ObservedObject private var debugLog = DebugLog.shared
  @State private var showDebug = false
  @State private var showChangelog = false
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    ZStack {
      OCSTheme.bg.ignoresSafeArea()
      AmbientBackground()

      Group {
        if model.room != nil {
          RoomView(showDebug: $showDebug, showChangelog: $showChangelog)
        } else {
          HomeView(showDebug: $showDebug, showChangelog: $showChangelog)
        }
      }
    }
    .overlay(alignment: .top) {
      if let toast = model.toast {
        Text(toast)
          .font(.footnote.weight(.medium))
          .foregroundStyle(OCSTheme.text)
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(.ultraThinMaterial, in: Capsule())
          .padding(.top, 12)
          .transition(.move(edge: .top).combined(with: .opacity))
          .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) {
              withAnimation { model.toast = nil }
            }
          }
      }
    }
    .animation(.spring(response: 0.35, dampingFraction: 0.86), value: model.toast)
    .sheet(isPresented: $showDebug) {
      DebugLogView()
        .environmentObject(debugLog)
    }
    .sheet(isPresented: $showChangelog) {
      ChangelogView()
    }
    .onChange(of: scenePhase) { phase in
      switch phase {
      case .active:
        model.handleAppActive()
      case .background:
        model.handleAppBackground()
      default:
        break
      }
    }
  }
}

struct AmbientBackground: View {
  var body: some View {
    ZStack {
      RadialGradient(
        colors: [OCSTheme.accent.opacity(0.22), .clear],
        center: .topLeading,
        startRadius: 20,
        endRadius: 420
      )
      RadialGradient(
        colors: [Color.cyan.opacity(0.08), .clear],
        center: .bottomTrailing,
        startRadius: 10,
        endRadius: 360
      )
    }
    .ignoresSafeArea()
  }
}

struct HomeView: View {
  @EnvironmentObject private var model: AppModel
  @Binding var showDebug: Bool
  @Binding var showChangelog: Bool
  @FocusState private var focused: Field?

  enum Field { case name, hostName, hostPin, link, code, pin }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        VStack(alignment: .leading, spacing: 8) {
          Text("OnCloudShare")
            .font(.system(size: 40, weight: .bold, design: .rounded))
            .foregroundStyle(OCSTheme.text)
          Text("Create a room on this phone or join a PC — local Wi‑Fi, no cloud drive.")
            .font(.body)
            .foregroundStyle(OCSTheme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 12)

        if let update = model.updateAvailable {
          UpdateBanner(asset: update)
        } else {
          UpdateCheckCard()
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 14) {
            Text("Create room")
              .font(.headline)
              .foregroundStyle(OCSTheme.text)
            Text("Host on this iPhone. PCs on the same Wi‑Fi can join via Bonjour or the LAN link.")
              .font(.caption)
              .foregroundStyle(OCSTheme.muted)
            labeledField("Your name", text: $model.displayName, field: .name)
            labeledField("Room name", text: $model.hostRoomName, field: .hostName)
            labeledField("PIN (optional)", text: $model.hostPin, field: .hostPin, prompt: "Guests must enter this")
              .keyboardType(.numberPad)

            Toggle(isOn: $model.hostPublic) {
              VStack(alignment: .leading, spacing: 2) {
                Text("Public room")
                  .foregroundStyle(OCSTheme.text)
                Text("Anyone with the link can join (not just Wi‑Fi). Uses a free temporary tunnel.")
                  .font(.caption2)
                  .foregroundStyle(OCSTheme.muted)
              }
            }
            .tint(OCSTheme.accent)

            Button("Create room") {
              model.createRoom()
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.connection == .connecting)

            Text("While hosting, keep OnCloudShare open (or return quickly after WhatsApp). iOS can pause the room in the background.")
              .font(.caption2)
              .foregroundStyle(OCSTheme.muted)
          }
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 14) {
            Text("Join room")
              .font(.headline)
              .foregroundStyle(OCSTheme.text)
            labeledField("Share link", text: $model.joinLink, field: .link, prompt: "https://….trycloudflare.com or LAN IP")
            labeledField("Room code", text: $model.joinCode, field: .code, prompt: "ABC123")
              .textInputAutocapitalization(.characters)
            labeledField("PIN (optional)", text: $model.joinPin, field: .pin, prompt: "If the host set one")
              .keyboardType(.numberPad)

            Button("Join room") {
              model.joinPasteLink()
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.connection == .connecting)

            statusLine
          }
        }

        HStack(spacing: 10) {
          Button {
            showChangelog = true
          } label: {
            Label("Changelog", systemImage: "list.bullet.rectangle")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(SecondaryButtonStyle())

          Button {
            showDebug = true
          } label: {
            Label("Debug log", systemImage: "ladybug")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(SecondaryButtonStyle())
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 8) {
            Text("How it works")
              .font(.headline)
              .foregroundStyle(OCSTheme.text)
            tip("Create a room here (LAN or Public) or on Windows")
            tip("Share the link / QR — remote guests use the public URL")
            tip("Keep this app open while hosting or sending large files")
          }
        }
      }
      .padding(20)
    }
  }

  private var statusLine: some View {
    HStack(spacing: 8) {
      Circle()
        .fill(statusColor)
        .frame(width: 8, height: 8)
      Text(statusText)
        .font(.caption)
        .foregroundStyle(OCSTheme.muted)
    }
  }

  private var statusColor: Color {
    switch model.connection {
    case .connected: return OCSTheme.online
    case .connecting, .reconnecting: return .orange
    case .failed: return OCSTheme.danger
    case .idle: return OCSTheme.muted
    }
  }

  private var statusText: String {
    switch model.connection {
    case .idle: return "Ready"
    case .connecting: return "Starting…"
    case .connected: return "Connected"
    case .reconnecting: return "Reconnecting…"
    case .failed(let m): return m
    }
  }

  private func labeledField(
    _ title: String,
    text: Binding<String>,
    field: Field,
    prompt: String = ""
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title.uppercased())
        .font(.caption.weight(.semibold))
        .tracking(0.6)
        .foregroundStyle(OCSTheme.muted)
      TextField(prompt, text: text)
        .padding(12)
        .background(OCSTheme.bg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(focused == field ? OCSTheme.accent.opacity(0.7) : OCSTheme.border, lineWidth: 1)
        )
        .focused($focused, equals: field)
        .foregroundStyle(OCSTheme.text)
    }
  }

  private func tip(_ text: String) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: "checkmark.circle.fill")
        .foregroundStyle(OCSTheme.accent)
      Text(text)
        .font(.subheadline)
        .foregroundStyle(OCSTheme.muted)
    }
  }
}

struct UpdateCheckCard: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 10) {
        Text("App updates")
          .font(.headline)
          .foregroundStyle(OCSTheme.text)
        Text("Installed \(model.installedVersion) · build \(model.installedBuild)")
          .font(.caption.monospaced())
          .foregroundStyle(OCSTheme.muted)
        if model.updateCheckBusy {
          ProgressView(value: nil as Double?)
            .tint(OCSTheme.accent)
          Text(model.lastUpdateCheckMessage.isEmpty ? "Checking…" : model.lastUpdateCheckMessage)
            .font(.caption)
            .foregroundStyle(OCSTheme.muted)
        } else {
          Button {
            model.checkForUpdates()
          } label: {
            Label("Check for updates", systemImage: "arrow.clockwise")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(SecondaryButtonStyle())
          if !model.lastUpdateCheckMessage.isEmpty {
            Text(model.lastUpdateCheckMessage)
              .font(.caption2)
              .foregroundStyle(OCSTheme.muted)
          }
        }
      }
    }
  }
}

struct UpdateBanner: View {
  @EnvironmentObject private var model: AppModel
  let asset: AppReleaseAsset

  var body: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 10) {
        Text("Update available")
          .font(.headline)
          .foregroundStyle(OCSTheme.text)
        Text(asset.name)
          .font(.caption)
          .foregroundStyle(OCSTheme.muted)
        Text("Installed \(model.installedVersion) · build \(model.installedBuild)")
          .font(.caption2.monospaced())
          .foregroundStyle(OCSTheme.muted)
        if model.updateBusy {
          ProgressView(value: nil as Double?)
            .tint(OCSTheme.accent)
          Text(model.updateStatus)
            .font(.caption)
            .foregroundStyle(OCSTheme.muted)
        } else {
          Button("Download & open in AltStore") {
            Task { await model.downloadAndShareUpdate() }
          }
          .buttonStyle(PrimaryButtonStyle())
          Button {
            model.checkForUpdates()
          } label: {
            Label("Check again", systemImage: "arrow.clockwise")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(SecondaryButtonStyle())
          .disabled(model.updateCheckBusy)
          Text("Downloads the IPA to this phone, then share → Open in AltStore. GitHub links are not passed to AltStore directly.")
            .font(.caption2)
            .foregroundStyle(OCSTheme.muted)
        }
      }
    }
  }
}

struct RoomView: View {
  @EnvironmentObject private var model: AppModel
  @Binding var showDebug: Bool
  @Binding var showChangelog: Bool
  @State private var photoItem: PhotosPickerItem?
  @State private var showImporter = false

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView {
        LazyVStack(spacing: 12) {
          if model.isHosting {
            HostInfoCard()
          }
          ForEach(model.items) { item in
            ItemRow(item: item)
          }
        }
        .padding(16)
      }
      composer
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        VStack(alignment: .leading, spacing: 2) {
          Text(model.room?.name ?? "Room")
            .font(.title3.weight(.bold))
            .foregroundStyle(OCSTheme.text)
          Text(model.room?.code ?? "")
            .font(.caption.monospaced())
            .foregroundStyle(OCSTheme.accent)
        }
        Spacer()
        Menu {
          Button("Copy room code") { model.copyRoomCode() }
          if model.isHosting {
            Button(model.shortShareURL != nil ? "Copy short link" : "Copy share link") {
              model.copyShortLink()
            }
            if model.tunnelStatus != .active {
              Button("Enable public link") {
                model.hostPublic = true
                model.regeneratePublicTunnel()
              }
            } else {
              Button("New public link") { model.regeneratePublicTunnel() }
            }
          }
          Button("Check for updates") { model.checkForUpdates() }
          Button("Changelog") { showChangelog = true }
          Button("Debug log") { showDebug = true }
          Divider()
          Button(model.isHosting ? "Close room" : "Leave", role: .destructive) { model.leave() }
        } label: {
          Image(systemName: "ellipsis.circle")
            .font(.title3)
            .foregroundStyle(OCSTheme.text)
        }
      }
      HStack(spacing: 8) {
        Circle().fill(OCSTheme.online).frame(width: 7, height: 7)
        Text(
          model.isHosting
            ? "Hosting · \(model.peers.count) online · keep app open"
            : "\(model.peers.count) online · keep this app open while sending"
        )
        .font(.caption)
        .foregroundStyle(OCSTheme.muted)
      }
      if model.uploadProgress > 0 && model.uploadProgress < 1 {
        ProgressView(value: model.uploadProgress)
          .tint(OCSTheme.accent)
        Text(model.uploadLabel)
          .font(.caption2)
          .foregroundStyle(OCSTheme.muted)
      }
    }
    .padding(16)
    .background(OCSTheme.surface.opacity(0.95))
  }

  private var composer: some View {
    VStack(spacing: 10) {
      TextField("Message, password, note…", text: $model.draft, axis: .vertical)
        .lineLimit(1...5)
        .padding(12)
        .background(OCSTheme.surface2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .foregroundStyle(OCSTheme.text)

      HStack(spacing: 10) {
        PhotosPicker(selection: $photoItem, matching: .any(of: [.images, .videos])) {
          Label("Photos", systemImage: "photo.on.rectangle")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(SecondaryButtonStyle())

        Button {
          showImporter = true
        } label: {
          Label("Files", systemImage: "paperclip")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(SecondaryButtonStyle())

        Button("Send") { model.sendDraft() }
          .buttonStyle(PrimaryButtonStyle())
          .frame(maxWidth: 110)
      }
    }
    .padding(16)
    .background(.ultraThinMaterial)
    .onChange(of: photoItem) { item in
      guard let item else { return }
      Task {
        if let data = try? await item.loadTransferable(type: Data.self) {
          model.sendImageData(data, name: "photo-\(Int(Date().timeIntervalSince1970)).jpg", mime: "image/jpeg")
        }
        photoItem = nil
      }
    }
    .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
      if case .success(let urls) = result {
        for url in urls { model.sendFile(url: url) }
      }
    }
  }
}

struct HostInfoCard: View {
  @EnvironmentObject private var model: AppModel
  @AppStorage("ocs.showQR") private var showQR = true

  var body: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 12) {
        Text("You're hosting")
          .font(.headline)
          .foregroundStyle(OCSTheme.text)

        if model.hostNeedsAttention {
          Text("Room was interrupted in the background — restoring. If the public link dies, tap New public link.")
            .font(.caption)
            .foregroundStyle(.orange)
        }

        if let share = model.bestShareURL {
          HStack {
            Text(model.publicShareURL != nil ? "Scan to join (public)" : "Scan to join (LAN)")
              .font(.caption)
              .foregroundStyle(OCSTheme.muted)
            Spacer()
            Button(showQR ? "Hide QR" : "Show QR") {
              withAnimation(.easeInOut(duration: 0.2)) { showQR.toggle() }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(OCSTheme.accent)
          }
          if showQR {
            QRCodeView(string: share, size: 168)
              .frame(maxWidth: .infinity)
              .transition(.opacity.combined(with: .scale(scale: 0.96)))
          }
        }

        if model.tunnelStatus == .starting {
          HStack(spacing: 8) {
            ProgressView().tint(OCSTheme.accent)
            Text("Creating public link…")
              .font(.caption)
              .foregroundStyle(OCSTheme.muted)
          }
        }

        if model.tunnelStatus == .active, let pub = model.publicShareURL {
          VStack(alignment: .leading, spacing: 6) {
            if let short = model.shortShareURL, let hint = model.shortShareHint {
              Text("SHORT LINK")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(OCSTheme.online)
              Text(hint)
                .font(.title3.monospaced().weight(.bold))
                .foregroundStyle(OCSTheme.accent)
                .textSelection(.enabled)
              Text(short)
                .font(.caption.monospaced())
                .foregroundStyle(OCSTheme.muted)
                .textSelection(.enabled)
              Text("Easy to type or send. Opens in any browser and jumps to your room.")
                .font(.caption2)
                .foregroundStyle(OCSTheme.muted)
            }
            Text("FULL LINK")
              .font(.caption2.weight(.semibold))
              .foregroundStyle(OCSTheme.muted)
            Text(pub)
              .font(.caption.monospaced())
              .foregroundStyle(OCSTheme.accent)
              .textSelection(.enabled)
            Text("Guests open the short or full link in Chrome. Keep this app open while hosting.")
              .font(.caption2)
              .foregroundStyle(OCSTheme.muted)
          }
        }

        if model.tunnelStatus == .error {
          Text(model.tunnelError ?? "Public link failed")
            .font(.caption)
            .foregroundStyle(OCSTheme.danger)
          Button("Retry public link") { model.regeneratePublicTunnel() }
            .buttonStyle(SecondaryButtonStyle())
        } else if model.tunnelStatus == .idle {
          Button("Enable public link") {
            model.hostPublic = true
            model.regeneratePublicTunnel()
          }
          .buttonStyle(SecondaryButtonStyle())
        } else if model.tunnelStatus == .active {
          Button("New public link") { model.regeneratePublicTunnel() }
            .buttonStyle(SecondaryButtonStyle())
        }

        VStack(alignment: .leading, spacing: 6) {
          Text("LAN")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(OCSTheme.muted)
          ForEach(model.lanURLs, id: \.self) { url in
            Text(url)
              .font(.caption.monospaced())
              .foregroundStyle(OCSTheme.accent)
              .textSelection(.enabled)
          }
        }

        HStack(spacing: 10) {
          if model.shortShareURL != nil {
            Button("Copy short") { model.copyShortLink() }
              .buttonStyle(SecondaryButtonStyle())
          }
          Button(model.shortShareURL != nil ? "Copy full" : "Copy link") {
            if model.shortShareURL != nil {
              model.copyPublicLink()
            } else {
              model.copyHostLink()
            }
          }
          .buttonStyle(SecondaryButtonStyle())
          Button("Copy code") { model.copyRoomCode() }
            .buttonStyle(SecondaryButtonStyle())
        }
      }
    }
  }
}

struct ItemRow: View {
  let item: RoomItem

  var body: some View {
    GlassCard {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text(item.fromName)
            .font(.caption.weight(.semibold))
            .foregroundStyle(OCSTheme.muted)
          Spacer()
          Text(timeString)
            .font(.caption2)
            .foregroundStyle(OCSTheme.muted)
        }
        switch item {
        case .text(let t):
          Text(t.text)
            .font(.body.monospaced())
            .foregroundStyle(OCSTheme.text)
            .textSelection(.enabled)
        case .file(let f):
          Label(f.name, systemImage: "doc.fill")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(OCSTheme.text)
          Text(ByteCountFormatter.string(fromByteCount: f.size, countStyle: .file))
            .font(.caption)
            .foregroundStyle(OCSTheme.muted)
        }
      }
    }
  }

  private var timeString: String {
    let date = Date(timeIntervalSince1970: item.createdAt / 1000)
    return date.formatted(date: .omitted, time: .shortened)
  }
}

struct DebugLogView: View {
  @EnvironmentObject private var log: DebugLog
  @Environment(\.dismiss) private var dismiss
  @State private var copied = false

  var body: some View {
    NavigationStack {
      ZStack {
        OCSTheme.bg.ignoresSafeArea()
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 8) {
            if log.lines.isEmpty {
              Text("No logs yet. Create or join a room to see activity.")
                .font(.subheadline)
                .foregroundStyle(OCSTheme.muted)
                .padding(.top, 24)
            } else {
              ForEach(log.lines.reversed()) { line in
                Text(line.formatted)
                  .font(.system(.caption, design: .monospaced))
                  .foregroundStyle(color(for: line.level))
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .textSelection(.enabled)
              }
            }
          }
          .padding(16)
        }
      }
      .navigationTitle("Debug log")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
        ToolbarItem(placement: .primaryAction) {
          HStack {
            Button("Clear") { log.clear() }
            Button(copied ? "Copied" : "Copy all") {
              UIPasteboard.general.string = log.allText
              copied = true
              ocsLog("Debug log copied (\(log.lines.count) lines)")
              DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
            }
            .disabled(log.lines.isEmpty)
          }
        }
      }
    }
    .preferredColorScheme(.dark)
  }

  private func color(for level: LogLevel) -> Color {
    switch level {
    case .debug: return OCSTheme.muted
    case .info: return OCSTheme.text
    case .warn: return .orange
    case .error: return OCSTheme.danger
    }
  }
}

struct ChangelogView: View {
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ZStack {
        OCSTheme.bg.ignoresSafeArea()
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            ForEach(Changelog.entries) { entry in
              GlassCard {
                VStack(alignment: .leading, spacing: 10) {
                  HStack {
                    Text(entry.version)
                      .font(.headline)
                      .foregroundStyle(entry.upcoming ? .orange : OCSTheme.accent)
                    Spacer()
                    Text(entry.date)
                      .font(.caption)
                      .foregroundStyle(OCSTheme.muted)
                  }
                  Text(entry.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OCSTheme.text)
                  ForEach(entry.items, id: \.self) { item in
                    HStack(alignment: .top, spacing: 8) {
                      Image(systemName: entry.upcoming ? "circle" : "checkmark.circle.fill")
                        .font(.caption)
                        .foregroundStyle(entry.upcoming ? OCSTheme.muted : OCSTheme.online)
                        .padding(.top, 2)
                      Text(item)
                        .font(.subheadline)
                        .foregroundStyle(OCSTheme.muted)
                    }
                  }
                }
              }
            }
          }
          .padding(16)
        }
      }
      .navigationTitle("Changelog")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close") { dismiss() }
        }
      }
    }
    .preferredColorScheme(.dark)
  }
}
