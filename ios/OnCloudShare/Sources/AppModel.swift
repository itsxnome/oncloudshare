import Foundation
import Combine
import UniformTypeIdentifiers
import UIKit

@MainActor
final class AppModel: ObservableObject {
  @Published var displayName: String {
    didSet { UserDefaults.standard.set(displayName, forKey: "ocs.name") }
  }
  @Published var joinCode: String = ""
  @Published var joinPin: String = ""
  @Published var joinLink: String = ""
  @Published var hostRoomName: String = "iPhone Room"
  @Published var hostPin: String = ""
  @Published var hostPublic = true
  @Published var isHosting = false
  @Published var hostNeedsAttention = false
  @Published var lanURLs: [String] = []
  @Published var publicURL: String?
  @Published var publicShareURL: String?
  @Published var shortShareURL: String?
  @Published var shortShareHint: String?
  @Published var tunnelStatus: TunnelUIStatus = .idle
  @Published var tunnelError: String?
  @Published var hostPort: UInt16 = 0
  @Published var connection: ConnectionState = .idle

  enum TunnelUIStatus: Equatable {
    case idle
    case starting
    case active
    case error
  }

  /// Avoid starting a second public tunnel for the same room session.
  private var autoTunnelStarted = false
  private var tunnelBoundPort: UInt16 = 0

  @Published var room: RoomInfo?
  @Published var peers: [PeerInfo] = []
  @Published var items: [RoomItem] = []
  @Published var draft: String = ""
  @Published var uploadProgress: Double = 0
  @Published var uploadLabel: String = ""
  @Published var toast: String?
  @Published var updateAvailable: AppReleaseAsset?
  @Published var updateBusy = false
  @Published var updateCheckBusy = false
  @Published var updateStatus: String = ""
  @Published var lastUpdateCheckMessage: String = ""

  var installedVersion: String {
    Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
  }

  var installedBuild: String {
    Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
  }

  private let client = ShareClient()
  private let host = RoomHost()
  private var pingTimer: Timer?
  private var baseURL: URL?
  private let chunkSize = 512 * 1024

  var peerId: String { client.peerId }

  init() {
    displayName = UserDefaults.standard.string(forKey: "ocs.name") ?? UIDevice.current.name
    hostRoomName = "\(displayName)'s room"
    wireClient()
    wireHost()
    ocsLog("App launched · peer \(client.peerId.prefix(8))…")
    Task { await refreshUpdateCheck(userInitiated: false) }
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
        ocsLog("Joined room \(room.code)")
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
        ocsLog(message, level: .error)
      }
    }
    client.onClose = { [weak self] in
      Task { @MainActor in
        guard let self else { return }
        if self.isHosting { return }
        if self.room != nil {
          self.connection = .reconnecting
          ocsLog("Disconnected — reconnecting…", level: .warn)
          self.scheduleReconnect()
        } else {
          self.connection = .idle
        }
      }
    }
  }

  private func wireHost() {
    host.onLog = { message, level in
      ocsLog(message, level: level)
    }
    host.onError = { [weak self] message in
      Task { @MainActor in
        HostKeepAlive.shared.stop()
        self?.connection = .failed(message)
        self?.toast = message
        self?.isHosting = false
        self?.hostNeedsAttention = false
      }
    }
    host.onListenerDefunct = { [weak self] message in
      Task { @MainActor in
        guard let self, self.isHosting else { return }
        self.hostNeedsAttention = true
        self.toast = "Room paused in background — reopen OnCloudShare to restore"
        ocsLog("Listener defunct while hosting: \(message)", level: .warn)
        // Recover immediately if we're already active; otherwise wait for foreground
        if UIApplication.shared.applicationState == .active {
          self.recoverHostAfterBackground()
        }
      }
    }
    host.onRoomReady = { [weak self] room, ips, port in
      Task { @MainActor in
        guard let self else { return }
        let previousPort = self.hostPort
        self.room = room
        self.isHosting = true
        self.hostNeedsAttention = false
        self.connection = .connected
        self.hostPort = port
        self.lanURLs = ips.map { "http://\($0):\(port)?code=\(room.code)" }
        HostKeepAlive.shared.start()

        let needTunnel = self.hostPublic && (
          !self.autoTunnelStarted || (previousPort != 0 && previousPort != port)
        )
        if needTunnel {
          if !self.autoTunnelStarted {
            self.toast = "Room \(room.code) live — starting public link…"
          } else {
            self.toast = "Port changed — refreshing public link…"
          }
          self.autoTunnelStarted = true
          self.tunnelBoundPort = port
          await self.startPublicTunnel()
        } else if self.toast == nil {
          self.toast = "Room \(room.code) is live"
        }
        ocsLog("Host ready · \(self.lanURLs.first ?? "")")
      }
    }
    host.onPeers = { [weak self] peers in
      Task { @MainActor in self?.peers = peers }
    }
    host.onItems = { [weak self] items in
      Task { @MainActor in
        self?.items = items.sorted { $0.createdAt > $1.createdAt }
      }
    }
  }

  func createRoom() {
    if isHosting || room != nil {
      leave()
    }
    connection = .connecting
    isHosting = true
    publicURL = nil
    publicShareURL = nil
    shortShareURL = nil
    shortShareHint = nil
    autoTunnelStarted = false
    tunnelBoundPort = 0
    hostNeedsAttention = false
    tunnelStatus = hostPublic ? .starting : .idle
    tunnelError = nil
    ocsLog("Create room requested · public=\(hostPublic)")
    PublicTunnel.shared.onLog = { message, level in ocsLog(message, level: level) }
    host.start(
      roomName: hostRoomName,
      hostName: displayName,
      pin: hostPin,
      hostPeerId: client.peerId
    )
  }

  func handleAppBackground() {
    guard isHosting else { return }
    HostKeepAlive.shared.handleDidEnterBackground()
    ocsLog("App backgrounded while hosting — keep-alive running", level: .warn)
  }

  func handleAppActive() {
    HostKeepAlive.shared.handleDidBecomeActive()
    guard isHosting else { return }
    if hostNeedsAttention {
      recoverHostAfterBackground()
    }
  }

  func recoverHostAfterBackground() {
    guard isHosting else { return }
    ocsLog("Recovering host after returning to app…", level: .warn)
    toast = "Restoring room…"
    host.recoverListener()
  }

  func startPublicTunnel() async {
    guard isHosting, hostPort > 0, let code = room?.code else { return }
    tunnelStatus = .starting
    tunnelError = nil
    shortShareURL = nil
    shortShareHint = nil
    ocsLog("Starting public tunnel on port \(hostPort)")
    do {
      let url = try await PublicTunnel.shared.start(localPort: hostPort)
      let base = url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      publicURL = base
      publicShareURL = "\(base)?code=\(code)"
      host.setTunnelUrl(base)
      var updated = room
      updated?.tunnelUrl = base
      room = updated
      tunnelStatus = .active
      ocsLog("Public share URL \(publicShareURL ?? "")")
      toast = "Public link ready — shortening…"
      if let long = publicShareURL, let short = await ShortLinkService.shorten(long) {
        shortShareURL = short
        shortShareHint = ShortLinkService.typingHint(from: short)
        toast = "Short link ready · \(shortShareHint ?? short)"
        ocsLog("Short link \(short)")
      } else {
        toast = "Public link ready (shortener unavailable — use full link)"
        ocsLog("Short link unavailable", level: .warn)
      }
    } catch {
      tunnelStatus = .error
      tunnelError = error.localizedDescription
      toast = "Public link failed — LAN still works"
      ocsLog("Public tunnel failed: \(error.localizedDescription)", level: .error)
    }
  }

  func regeneratePublicTunnel() {
    Task { await startPublicTunnel() }
  }

  /// Prefer short public link for QR / WhatsApp; fall back to full tunnel or LAN.
  var bestShareURL: String? {
    shortShareURL ?? publicShareURL ?? lanURLs.first
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
    if isHosting {
      leave()
    }
    let resolvedCode = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard !resolvedCode.isEmpty else {
      toast = "Enter a room code"
      return
    }
    self.baseURL = baseURL
    connection = .connecting
    ocsLog("Joining \(baseURL.absoluteString) code=\(resolvedCode)")
    client.connect(baseURL: baseURL, name: displayName, code: resolvedCode, pin: joinPin)
  }

  func joinPasteLink() {
    let raw = joinLink.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = Self.normalizeShareURL(raw) else {
      toast = "Invalid share link"
      ocsLog("Invalid join link: \(raw)", level: .warn)
      return
    }
    var code = joinCode
    if code.isEmpty {
      code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?
        .first(where: { $0.name == "code" })?
        .value ?? ""
    }
    join(baseURL: url, code: code)
  }

  func leave() {
    pingTimer?.invalidate()
    HostKeepAlive.shared.stop()
    PublicTunnel.shared.stop()
    if isHosting {
      host.stop()
      isHosting = false
      ocsLog("Host room closed")
    } else {
      client.disconnect(sendLeave: true)
    }
    room = nil
    peers = []
    items = []
    lanURLs = []
    publicURL = nil
    publicShareURL = nil
    shortShareURL = nil
    shortShareHint = nil
    hostPort = 0
    tunnelBoundPort = 0
    autoTunnelStarted = false
    hostNeedsAttention = false
    tunnelStatus = .idle
    tunnelError = nil
    connection = .idle
    baseURL = nil
  }

  func copyHostLink() {
    let link = bestShareURL ?? lanURLs.first
    guard let link else { return }
    UIPasteboard.general.string = link
    if shortShareURL != nil {
      toast = "Short link copied"
    } else if publicShareURL != nil {
      toast = "Public link copied"
    } else {
      toast = "LAN link copied"
    }
  }

  func copyShortLink() {
    guard let link = shortShareURL else {
      copyHostLink()
      return
    }
    UIPasteboard.general.string = link
    toast = "Short link copied · \(shortShareHint ?? link)"
  }

  func copyPublicLink() {
    guard let link = publicShareURL else { return }
    UIPasteboard.general.string = link
    toast = "Full public link copied"
  }

  func sendDraft() {
    let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if isHosting {
      host.hostSendText(text)
    } else {
      client.sendText(text)
    }
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
        ocsLog("File send failed: \(error.localizedDescription)", level: .error)
      }
    }
  }

  func sendImageData(_ data: Data, name: String, mime: String) {
    Task {
      do {
        try await upload(data: data, name: name, mime: mime)
      } catch {
        toast = error.localizedDescription
        ocsLog("Image send failed: \(error.localizedDescription)", level: .error)
      }
    }
  }

  private func upload(data: Data, name: String, mime: String) async throws {
    guard room != nil else { throw URLError(.notConnectedToInternet) }
    if isHosting {
      uploadLabel = "Sharing \(name)"
      uploadProgress = 0.5
      host.hostSendFile(data: data, name: name, mime: mime)
      uploadProgress = 1
      uploadLabel = ""
      toast = "Shared \(name)"
      return
    }
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
    ocsLog("Uploaded \(name) (\(total) bytes)")
  }

  private func startPing() {
    pingTimer?.invalidate()
    pingTimer = Timer.scheduledTimer(withTimeInterval: 12, repeats: true) { [weak self] _ in
      Task { @MainActor in
        guard let self, !self.isHosting else { return }
        self.client.ping()
      }
    }
  }

  private func scheduleReconnect() {
    guard let baseURL, let room, !isHosting else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      guard let self, self.connection == .reconnecting else { return }
      self.client.connect(baseURL: baseURL, name: self.displayName, code: room.code, pin: self.joinPin)
    }
  }

  func copyRoomCode() {
    guard let code = room?.code else { return }
    UIPasteboard.general.string = code
    toast = "Code copied"
  }

  func refreshUpdateCheck(userInitiated: Bool = false) async {
    if userInitiated {
      updateCheckBusy = true
      lastUpdateCheckMessage = "Checking GitHub Releases…"
    }
    defer {
      if userInitiated { updateCheckBusy = false }
    }
    do {
      updateAvailable = try await UpdateService.shared.latestIPA()
      if let asset = updateAvailable {
        let msg = "Update available: \(asset.name)"
        lastUpdateCheckMessage = msg
        ocsLog(msg)
        if userInitiated {
          toast = msg
        }
      } else {
        let msg = "You're on \(installedVersion) (build \(installedBuild)) — latest on GitHub"
        lastUpdateCheckMessage = msg
        ocsLog(msg)
        if userInitiated {
          toast = "No update — you're on \(installedVersion)"
        }
      }
    } catch {
      let msg = "Update check failed: \(error.localizedDescription)"
      lastUpdateCheckMessage = msg
      ocsLog(msg, level: .warn)
      if userInitiated {
        toast = msg
      }
    }
  }

  func checkForUpdates() {
    Task { await refreshUpdateCheck(userInitiated: true) }
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
      ocsLog("IPA downloaded for AltStore")
    } catch {
      updateStatus = error.localizedDescription
      toast = error.localizedDescription
      ocsLog("Update download failed: \(error.localizedDescription)", level: .error)
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
