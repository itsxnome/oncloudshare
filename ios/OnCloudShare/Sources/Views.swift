import SwiftUI
import PhotosUI

struct RootView: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    ZStack {
      OCSTheme.bg.ignoresSafeArea()
      AmbientBackground()

      Group {
        if model.room != nil {
          RoomView()
        } else {
          HomeView()
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
  @FocusState private var focused: Field?

  enum Field { case name, link, code, pin }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        VStack(alignment: .leading, spacing: 8) {
          Text("OnCloudShare")
            .font(.system(size: 40, weight: .bold, design: .rounded))
            .foregroundStyle(OCSTheme.text)
          Text("Join your PC room from this phone — no cloud drive, no chat apps.")
            .font(.body)
            .foregroundStyle(OCSTheme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 12)

        if let update = model.updateAvailable {
          UpdateBanner(asset: update)
        }

        GlassCard {
          VStack(alignment: .leading, spacing: 14) {
            labeledField("Your name", text: $model.displayName, field: .name)
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

        GlassCard {
          VStack(alignment: .leading, spacing: 8) {
            Text("How it works")
              .font(.headline)
              .foregroundStyle(OCSTheme.text)
            tip("Create a room on your Windows PC")
            tip("Scan the QR or paste the remote / LAN link here")
            tip("Keep this app open while sending large files")
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
    case .idle: return "Ready to join"
    case .connecting: return "Connecting…"
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
  @State private var photoItem: PhotosPickerItem?
  @State private var showImporter = false

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView {
        LazyVStack(spacing: 12) {
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
        Button("Leave") { model.leave() }
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(OCSTheme.danger)
      }
      HStack(spacing: 8) {
        Circle().fill(OCSTheme.online).frame(width: 7, height: 7)
        Text("\(model.peers.count) online · keep this app open while sending")
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
