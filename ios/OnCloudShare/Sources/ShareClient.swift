import Foundation

/// Built-in WebSocket client for OnCloudShare rooms (no external backend).
final class ShareClient: NSObject, URLSessionWebSocketDelegate {
  private var session: URLSession!
  private var task: URLSessionWebSocketTask?
  private(set) var peerId: String
  var onWelcome: ((RoomInfo, [PeerInfo], [RoomItem]) -> Void)?
  var onItem: ((RoomItem) -> Void)?
  var onItems: (([RoomItem]) -> Void)?
  var onPeers: (([PeerInfo]) -> Void)?
  var onError: ((String) -> Void)?
  var onClose: (() -> Void)?
  var onPong: (() -> Void)?

  override init() {
    if let saved = UserDefaults.standard.string(forKey: "ocs.peerId") {
      peerId = saved
    } else {
      peerId = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
      UserDefaults.standard.set(peerId, forKey: "ocs.peerId")
    }
    super.init()
    session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
  }

  private var connectTimeout: DispatchWorkItem?

  func connect(baseURL: URL, name: String, code: String, pin: String?) {
    disconnect(sendLeave: false)
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
    components.scheme = (baseURL.scheme == "https") ? "wss" : "ws"
    components.path = "/ws"
    components.query = nil
    guard let wsURL = components.url else {
      onError?("Invalid share link")
      return
    }
    var req = URLRequest(url: wsURL)
    // loca.lt interstitial bypass for public tunnels (browsers still see the page)
    req.setValue("true", forHTTPHeaderField: "Bypass-Tunnel-Reminder")
    req.setValue("bypass-tunnel-reminder", forHTTPHeaderField: "bypass-tunnel-reminder")
    req.setValue("OnCloudShare-iOS/1.2.3", forHTTPHeaderField: "User-Agent")
    req.timeoutInterval = 25
    let task = session.webSocketTask(with: req)
    self.task = task
    task.resume()
    listen()

    let timeout = DispatchWorkItem { [weak self] in
      guard let self, self.task != nil else { return }
      self.onError?(
        "Join timed out. Free public tunnels are often slow — tap Join again, or use the LAN link on the same Wi‑Fi."
      )
      self.disconnect(sendLeave: false)
      self.onClose?()
    }
    connectTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 22, execute: timeout)

    var join: [String: Any] = [
      "type": "join",
      "peerId": peerId,
      "name": name.isEmpty ? "iPhone" : name,
      "code": code.uppercased(),
    ]
    if let pin, !pin.isEmpty { join["pin"] = pin }
    // Small delay so the WS handshake can finish before the first frame
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
      self?.sendJSON(join)
    }
  }

  func disconnect(sendLeave: Bool) {
    connectTimeout?.cancel()
    connectTimeout = nil
    if sendLeave {
      sendJSON(["type": "leave"])
    }
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
  }

  func sendText(_ text: String) {
    sendJSON(["type": "text", "text": text])
  }

  func ping() {
    sendJSON(["type": "ping"])
  }

  func sendFileMeta(
    fileId: String,
    name: String,
    size: Int,
    mimeType: String,
    totalChunks: Int,
    chunkSize: Int
  ) {
    sendJSON([
      "type": "file-meta",
      "fileId": fileId,
      "name": name,
      "size": size,
      "mimeType": mimeType,
      "totalChunks": totalChunks,
      "chunkSize": chunkSize,
      "binary": true,
    ])
  }

  func sendBinaryChunk(fileId: String, index: UInt32, data: Data) {
    guard let task else { return }
    var frame = Data()
    frame.append(contentsOf: [0x4F, 0x43, 0x53, 0x46]) // OCSF
    frame.append(1) // version
    frame.append(1) // type chunk
    let idData = Data(fileId.utf8)
    frame.append(UInt8(idData.count))
    frame.append(0)
    frame.append(idData)
    var idx = index.bigEndian
    withUnsafeBytes(of: &idx) { frame.append(contentsOf: $0) }
    frame.append(data)
    task.send(.data(frame)) { [weak self] error in
      if let error {
        self?.onError?(error.localizedDescription)
      }
    }
  }

  private func sendJSON(_ obj: [String: Any]) {
    guard let task, let data = try? JSONSerialization.data(withJSONObject: obj),
          let str = String(data: data, encoding: .utf8)
    else { return }
    task.send(.string(str)) { [weak self] error in
      if let error {
        self?.onError?(error.localizedDescription)
      }
    }
  }

  private func listen() {
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .failure:
        self.onClose?()
      case .success(let message):
        switch message {
        case .string(let text):
          self.handleText(text)
        case .data:
          break
        @unknown default:
          break
        }
        self.listen()
      }
    }
  }

  private func handleText(_ text: String) {
    guard let data = text.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = json["type"] as? String
    else { return }

    switch type {
    case "welcome":
      connectTimeout?.cancel()
      connectTimeout = nil
      let roomDict = json["room"] as? [String: Any] ?? [:]
      let room = RoomInfo(
        code: roomDict["code"] as? String ?? "",
        name: roomDict["name"] as? String ?? "Room",
        hostName: roomDict["hostName"] as? String ?? "Host",
        port: roomDict["port"] as? Int,
        tunnelUrl: roomDict["tunnelUrl"] as? String,
        hasPin: roomDict["pin"] != nil
      )
      let peers = Self.parsePeers(json["peers"])
      let items = Self.parseItems(json["items"])
      onWelcome?(room, peers, items)
    case "item":
      if let itemObj = json["item"], let item = Self.parseItem(itemObj) {
        onItem?(item)
      }
    case "items":
      onItems?(Self.parseItems(json["items"]))
    case "peers":
      onPeers?(Self.parsePeers(json["peers"]))
    case "error":
      onError?(json["message"] as? String ?? "Connection error")
    case "pong":
      onPong?()
    case "room-closed":
      onError?("Host closed the room")
      onClose?()
    default:
      break
    }
  }

  private static func parsePeers(_ raw: Any?) -> [PeerInfo] {
    guard let arr = raw as? [[String: Any]] else { return [] }
    return arr.compactMap { dict in
      guard let id = dict["id"] as? String, let name = dict["name"] as? String else { return nil }
      return PeerInfo(id: id, name: name, joinedAt: dict["joinedAt"] as? Double)
    }
  }

  private static func parseItems(_ raw: Any?) -> [RoomItem] {
    guard let arr = raw as? [Any] else { return [] }
    return arr.compactMap(parseItem)
  }

  private static func parseItem(_ raw: Any) -> RoomItem? {
    guard let dict = raw as? [String: Any], let type = dict["type"] as? String, let id = dict["id"] as? String else {
      return nil
    }
    let from = dict["from"] as? String ?? ""
    let fromName = dict["fromName"] as? String ?? "Peer"
    let createdAt = dict["createdAt"] as? Double ?? Date().timeIntervalSince1970 * 1000
    if type == "text" {
      return .text(
        TextItem(
          id: id,
          text: dict["text"] as? String ?? "",
          from: from,
          fromName: fromName,
          createdAt: createdAt
        )
      )
    }
    if type == "file" {
      return .file(
        FileItem(
          id: id,
          name: dict["name"] as? String ?? "file",
          size: (dict["size"] as? NSNumber)?.int64Value ?? 0,
          mimeType: dict["mimeType"] as? String ?? "application/octet-stream",
          from: from,
          fromName: fromName,
          createdAt: createdAt
        )
      )
    }
    return nil
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    onClose?()
  }
}
