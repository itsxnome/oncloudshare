import Foundation
import Combine
import UniformTypeIdentifiers

@MainActor
final class AppModel: ObservableObject {
  @Published var displayName: String {
    didSet { UserDefaults.standard.set(displayName, forKey: "ocs.name") }
  }
  @Published var joinCode: String = ""
  @Published var joinPin: String = ""
  @Published var joinLink: String = ""
  @Published var connection: ConnectionState = .idle
  @Published var room: RoomInfo?
  @Published var peers: [PeerInfo] = []
  @Published var items: [RoomItem] = []
  @Published var draft: String = ""
  @Published var uploadProgress: Double = 0
  @Published var uploadLabel: String = ""
  @Published var toast: String?
  @Published var updateAvailable: AppReleaseAsset?
  @Published var updateBusy = false
  @Published var updateStatus: String = ""

  private let client = ShareClient()
  private var pingTimer: Timer?
  private var baseURL: URL?
  private let chunkSize = 512 * 1024

  init() {
    displayName = UserDefaults.standard.string(forKey: "ocs.name") ?? "iPhone"
    wireClient()
    Task { await refreshUpdateCheck() }
  }

  private func wireClient() {
    client.onWelcome = { [weak self] room, peers, items in
      Task { @MainActor in
        self?.room = room
        self?.peers = peers
        self?.items = items.sorted { $0.createdAt > $1.createdAt }
        self?.connection = .connected
        self?.startPing()
        self?.toast = "Connected to \(room.name)"
      }
    }
    client.onItem = { [weak self] item in
      Task { @MainActor in
        guard let self else { return }
        self.items.removeAll { $0.id == item.id }
        self.items.insert(item, at: 0)
      }
    }
    client.onItems = { [weak self] items in
      Task { @MainActor in
        self?.items = items.sorted { $0.createdAt > $1.createdAt }
      }
    }
    client.onPeers = { [weak self] peers in
      Task { @MainActor in
        self?.peers = peers
      }
    }
    client.onError = { [weak self] message in
      Task { @MainActor in
        self?.connection = .failed(message)
        self?.toast = message
      }
    }
    client.onClose = { [weak self] in
      Task { @MainActor in
        guard let self else { return }
        if self.room != nil {
          self.connection = .reconnecting
          self.scheduleReconnect()
        } else {
          self.connection = .idle
        }
      }
    }
  }

  func joinFromFields() {
    let trimmedLink = joinLink.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedLink.isEmpty, let url = Self.normalizeShareURL(trimmedLink) {
      join(baseURL: url, code: joinCode.isEmpty ? (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value ?? "") : joinCode)
      return
    }
    guard let url = URL(string: trimmedLink.isEmpty ? "http://127.0.0.1" : trimmedLink) else {
      toast = "Paste a share link or LAN address"
      return
    }
    _ = url
  }

  func join(baseURL: URL, code: String) {
    let resolvedCode = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard !resolvedCode.isEmpty else {
      toast = "Enter a room code"
      return
    }
    self.baseURL = baseURL
    connection = .connecting
    client.connect(baseURL: baseURL, name: displayName, code: resolvedCode, pin: joinPin)
  }

  func joinPasteLink() {
    let raw = joinLink.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = Self.normalizeShareURL(raw) else {
      toast = "Invalid share link"
      return
    }
    var code = joinCode
    if code.isEmpty {
      code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?
        .first(where: { $0.name == "code" })?
        .value ?? ""
    }
    // Also try path fragments like /m?code=
    join(baseURL: url, code: code)
  }

  func leave() {
    pingTimer?.invalidate()
    client.disconnect(sendLeave: true)
    room = nil
    peers = []
    items = []
    connection = .idle
    baseURL = nil
  }

  func sendDraft() {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    client.sendText(text)
    draft = ""
  }

  func sendFile(url: URL) {
    Task {
      do {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        let name = url.lastPathComponent
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        try await upload(data: data, name: name, mime: mime)
      } catch {
        toast = error.localizedDescription
      }
    }
  }

  func sendImageData(_ data: Data, name: String, mime: String) {
    Task {
      do {
        try await upload(data: data, name: name, mime: mime)
      } catch {
        toast = error.localizedDescription
      }
    }
  }

  private func upload(data: Data, name: String, mime: String) async throws {
    guard room != nil else { throw URLError(.notConnectedToInternet) }
    let total = data.count
    let totalChunks = max(1, Int(ceil(Double(total) / Double(chunkSize))))
    let fileId = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    uploadLabel = "Uploading \(name)"
    uploadProgress = 0.02
    client.sendFileMeta(
      fileId: fileId,
      name: name,
      size: total,
      mimeType: mime,
      totalChunks: totalChunks,
      chunkSize: chunkSize
    )
    for i in 0..<totalChunks {
      let start = i * chunkSize
      let end = min(total, start + chunkSize)
      let slice = data.subdata(in: start..<end)
      client.sendBinaryChunk(fileId: fileId, index: UInt32(i), data: slice)
      uploadProgress = Double(i + 1) / Double(totalChunks)
      await Task.yield()
    }
    uploadProgress = 1
    uploadLabel = ""
    toast = "Sent \(name)"
  }

  private func startPing() {
    pingTimer?.invalidate()
    pingTimer = Timer.scheduledTimer(withTimeInterval: 12, repeats: true) { [weak self] _ in
      Task { @MainActor in
        self?.client.ping()
      }
    }
  }

  private func scheduleReconnect() {
    guard let baseURL, let room else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      guard let self, self.connection == .reconnecting else { return }
      self.client.connect(baseURL: baseURL, name: self.displayName, code: room.code, pin: self.joinPin)
    }
  }

  func refreshUpdateCheck() async {
    do {
      updateAvailable = try await UpdateService.shared.latestIPA()
    } catch {
      // silent — update check is best-effort
    }
  }

  func downloadAndShareUpdate() async {
    guard let asset = updateAvailable else { return }
    updateBusy = true
    updateStatus = "Downloading update…"
    defer { updateBusy = false }
    do {
      let fileURL = try await UpdateService.shared.downloadIPA(asset: asset) { [weak self] progress in
        Task { @MainActor in
          self?.updateStatus = "Downloading \(Int(progress * 100))%"
        }
      }
      updateStatus = "Ready — open in AltStore"
      UpdateService.shared.shareIPA(fileURL)
      toast = "Share the IPA → Open in AltStore"
    } catch {
      updateStatus = error.localizedDescription
      toast = error.localizedDescription
    }
  }

  static func normalizeShareURL(_ raw: String) -> URL? {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { return nil }
    if !s.contains("://") {
      if s.contains(".") || s.contains(":") {
        s = "http://\(s)"
      } else {
        return nil
      }
    }
    return URL(string: s)
  }
}
