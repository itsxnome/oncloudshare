import Foundation
import Network

/// LAN room host: HTTP (/health, /room, /files) + WebSocket (/ws) + Bonjour.
final class RoomHost {
  struct StoredFile {
    var item: [String: Any]
    var data: Data?
    var fileURL: URL?
  }

  struct IncomingTransfer {
    var fileId: String
    var name: String
    var size: Int
    var mimeType: String
    var totalChunks: Int
    var chunkSize: Int
    var from: String
    var fromName: String
    var nextIndex: Int = 0
    var received: Int = 0
    var handle: FileHandle?
    var partialURL: URL
  }

  fileprivate let workQueue = DispatchQueue(label: "com.oncloudshare.roomhost")
  private var listener: NWListener?
  private var connections: [ObjectIdentifier: PeerConnection] = [:]
  private var roomCode = ""
  private var roomName = ""
  private var hostName = ""
  private var pin: String?
  private var hostPeerId = ""
  private var port: UInt16 = 0
  private var peers: [[String: Any]] = []
  private var items: [[String: Any]] = []
  private var files: [String: StoredFile] = [:]
  private var transfers: [String: IncomingTransfer] = [:]
  private let staging: URL
  private let maxItems = 200

  var onRoomReady: ((RoomInfo, [String], UInt16) -> Void)?
  var onPeers: (([PeerInfo]) -> Void)?
  var onItems: (([RoomItem]) -> Void)?
  var onError: ((String) -> Void)?
  var onLog: ((String, LogLevel) -> Void)?

  init() {
    staging = FileManager.default.temporaryDirectory.appendingPathComponent("ocs-host", isDirectory: true)
    try? FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
  }

  func start(roomName: String, hostName: String, pin: String?, hostPeerId: String) {
    workQueue.async { [weak self] in
      self?.startLocked(roomName: roomName, hostName: hostName, pin: pin, hostPeerId: hostPeerId)
    }
  }

  func stop() {
    workQueue.async { [weak self] in
      self?.stopLocked()
    }
  }

  func hostSendText(_ text: String) {
    workQueue.async { [weak self] in
      guard let self else { return }
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return }
      let item: [String: Any] = [
        "id": Self.hexId(),
        "type": "text",
        "text": trimmed,
        "from": self.hostPeerId,
        "fromName": self.hostName,
        "createdAt": Date().timeIntervalSince1970 * 1000,
      ]
      self.pushItem(item)
      self.broadcast(["type": "item", "item": item])
      self.emitItems()
    }
  }

  func hostSendFile(data: Data, name: String, mime: String) {
    workQueue.async { [weak self] in
      guard let self else { return }
      let id = Self.hexId()
      let url = self.staging.appendingPathComponent("\(id)-\(Self.safeName(name))")
      do {
        try data.write(to: url, options: .atomic)
      } catch {
        self.log("Failed to stage host file: \(error.localizedDescription)", .error)
        return
      }
      let item: [String: Any] = [
        "id": id,
        "type": "file",
        "name": name,
        "size": data.count,
        "mimeType": mime,
        "from": self.hostPeerId,
        "fromName": self.hostName,
        "createdAt": Date().timeIntervalSince1970 * 1000,
      ]
      self.files[id] = StoredFile(item: item, data: data.count <= 8 * 1024 * 1024 ? data : nil, fileURL: url)
      self.pushItem(item)
      self.broadcast(["type": "item", "item": item])
      self.emitItems()
    }
  }

  // MARK: - Private

  private func startLocked(roomName: String, hostName: String, pin: String?, hostPeerId: String) {
    stopLocked()
    self.roomName = roomName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "iPhone Room" : roomName
    self.hostName = hostName.isEmpty ? "iPhone" : hostName
    let trimmedPin = (pin ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    self.pin = trimmedPin.isEmpty ? nil : trimmedPin
    self.hostPeerId = hostPeerId
    self.roomCode = Self.generateCode()
    self.peers = [[
      "id": hostPeerId,
      "name": self.hostName,
      "joinedAt": Date().timeIntervalSince1970 * 1000,
    ]]
    self.items = []
    self.files = [:]

    let params = NWParameters.tcp
    params.allowLocalEndpointReuse = true
    params.includePeerToPeer = true

    do {
      let listener = try NWListener(using: params, on: .any)
      self.listener = listener
      var txt = NWTXTRecord([
        "code": roomCode,
        "room": self.roomName,
        "hostName": self.hostName,
      ])
      listener.service = NWListener.Service(
        name: "OnCloudShare-\(roomCode)",
        type: "_oncloudshare._tcp",
        txtRecord: txt
      )
      listener.stateUpdateHandler = { [weak self] state in
        guard let self else { return }
        self.workQueue.async {
          switch state {
          case .ready:
            let p = self.listener?.port?.rawValue ?? 0
            self.port = p
            self.log("Host listening on port \(p)", .info)
            self.emitReady()
          case .failed(let err):
            self.log("Listener failed: \(err)", .error)
            self.onError?("Could not start room: \(err.localizedDescription)")
          case .cancelled:
            self.log("Listener cancelled", .debug)
          default:
            break
          }
        }
      }
      listener.newConnectionHandler = { [weak self] conn in
        self?.workQueue.async { self?.accept(conn) }
      }
      listener.start(queue: workQueue)
      log("Creating room \(roomCode)…", .info)
    } catch {
      log("Start failed: \(error.localizedDescription)", .error)
      onError?("Could not start room: \(error.localizedDescription)")
    }
  }

  private func stopLocked() {
    for (_, peer) in connections {
      peer.close()
    }
    connections.removeAll()
    for t in transfers.values {
      try? t.handle?.close()
      try? FileManager.default.removeItem(at: t.partialURL)
    }
    transfers.removeAll()
    listener?.cancel()
    listener = nil
    port = 0
    log("Host stopped", .info)
  }

  private func accept(_ connection: NWConnection) {
    let peer = PeerConnection(connection: connection, host: self)
    connections[ObjectIdentifier(peer)] = peer
    peer.start()
    log("Incoming connection", .debug)
  }

  fileprivate func removePeerConnection(_ peer: PeerConnection) {
    let id = ObjectIdentifier(peer)
    guard let existing = connections.removeValue(forKey: id) else { return }
    if existing.joined {
      peers.removeAll { ($0["id"] as? String) == existing.peerId }
      broadcast(["type": "peers", "peers": peers])
      emitPeers()
      log("Peer left: \(existing.name)", .info)
    }
  }

  fileprivate func handleHTTP(request: HTTPRequest, peer: PeerConnection) {
    let path = request.path.split(separator: "?").first.map(String.init) ?? request.path
    if request.isWebSocketUpgrade, path == "/ws" || path.hasPrefix("/ws") {
      peer.upgradeWebSocket(key: request.webSocketKey ?? "")
      return
    }

    if path == "/health" {
      peer.sendHTTP(status: 200, body: jsonString(["ok": true, "room": roomCode]))
      return
    }
    if path == "/room" {
      peer.sendHTTP(
        status: 200,
        body: jsonString([
          "code": roomCode,
          "name": roomName,
          "hostName": hostName,
          "hasPin": pin != nil,
          "port": Int(port),
        ])
      )
      return
    }
    if path.hasPrefix("/files/") {
      serveFile(path: path, query: request.query, peer: peer)
      return
    }
    peer.sendHTTP(status: 404, body: "{\"error\":\"Not found\"}")
  }

  private func serveFile(path: String, query: [String: String], peer: PeerConnection) {
    let id = String(path.dropFirst("/files/".count))
    let code = (query["code"] ?? "").uppercased()
    if code != roomCode {
      peer.sendHTTP(status: 403, body: "{\"error\":\"Invalid room code\"}")
      return
    }
    if let pin, !pin.isEmpty, (query["pin"] ?? "") != pin {
      peer.sendHTTP(status: 403, body: "{\"error\":\"Invalid PIN\"}")
      return
    }
    guard let stored = files[id] else {
      peer.sendHTTP(status: 404, body: "{\"error\":\"File not found\"}")
      return
    }
    let data: Data
    if let d = stored.data {
      data = d
    } else if let url = stored.fileURL, let d = try? Data(contentsOf: url) {
      data = d
    } else {
      peer.sendHTTP(status: 404, body: "{\"error\":\"File data unavailable\"}")
      return
    }
    let mime = (stored.item["mimeType"] as? String) ?? "application/octet-stream"
    let name = (stored.item["name"] as? String) ?? "file"
    peer.sendHTTP(
      status: 200,
      headers: [
        "Content-Type": mime,
        "Content-Length": "\(data.count)",
        "Content-Disposition": "attachment; filename*=UTF-8''\(name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? name)",
        "Accept-Ranges": "bytes",
      ],
      bodyData: data
    )
  }

  fileprivate func handleWSJSON(_ text: String, peer: PeerConnection) {
    guard let data = text.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = json["type"] as? String
    else { return }

    switch type {
    case "ping":
      peer.sendJSON(["type": "pong"])
    case "join":
      handleJoin(json, peer: peer)
    case "text":
      guard peer.joined else {
        peer.sendJSON(["type": "error", "message": "Join the room first."])
        return
      }
      let body = (json["text"] as? String) ?? ""
      let item: [String: Any] = [
        "id": Self.hexId(),
        "type": "text",
        "text": body,
        "from": peer.peerId,
        "fromName": peer.name,
        "createdAt": Date().timeIntervalSince1970 * 1000,
      ]
      pushItem(item)
      broadcast(["type": "item", "item": item])
      emitItems()
      log("Text from \(peer.name)", .info)
    case "file-meta":
      guard peer.joined else { return }
      handleFileMeta(json, peer: peer)
    case "file-chunk":
      guard peer.joined else { return }
      if let fileId = json["fileId"] as? String,
         let index = json["index"] as? Int,
         let b64 = json["data"] as? String,
         let chunk = Data(base64Encoded: b64)
      {
        appendChunk(fileId: fileId, index: index, data: chunk)
      }
    case "file-cancel":
      if let fileId = json["fileId"] as? String {
        cancelTransfer(fileId)
      }
    case "leave":
      peer.close()
    default:
      break
    }
  }

  fileprivate func handleWSBinary(_ data: Data, peer: PeerConnection) {
    guard peer.joined, let decoded = OCSFCodec.decodeChunk(data) else { return }
    appendChunk(fileId: decoded.fileId, index: Int(decoded.index), data: decoded.payload)
  }

  private func handleJoin(_ json: [String: Any], peer: PeerConnection) {
    let code = ((json["code"] as? String) ?? "").uppercased()
    if code != roomCode {
      peer.sendJSON(["type": "error", "message": "Invalid room code."])
      return
    }
    if let pin, !pin.isEmpty, (json["pin"] as? String) != pin {
      peer.sendJSON(["type": "error", "message": "Invalid PIN."])
      return
    }
    peer.peerId = (json["peerId"] as? String) ?? Self.hexId()
    peer.name = (json["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Guest"
    peer.joined = true
    peers.removeAll { ($0["id"] as? String) == peer.peerId }
    peers.append([
      "id": peer.peerId,
      "name": peer.name,
      "joinedAt": Date().timeIntervalSince1970 * 1000,
    ])
    var room: [String: Any] = [
      "code": roomCode,
      "name": roomName,
      "hostName": hostName,
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "port": Int(port),
      "localIps": Self.localIPv4s(),
    ]
    if let pin { room["pin"] = pin }
    peer.sendJSON([
      "type": "welcome",
      "peerId": peer.peerId,
      "room": room,
      "peers": peers,
      "items": items,
    ])
    broadcast(["type": "peers", "peers": peers], except: peer)
    emitPeers()
    log("\(peer.name) joined", .info)
  }

  private func handleFileMeta(_ json: [String: Any], peer: PeerConnection) {
    guard let fileId = json["fileId"] as? String,
          let name = json["name"] as? String,
          let size = json["size"] as? Int,
          let totalChunks = json["totalChunks"] as? Int
    else { return }
    let mime = (json["mimeType"] as? String) ?? "application/octet-stream"
    let chunkSize = (json["chunkSize"] as? Int) ?? (512 * 1024)
    let partial = staging.appendingPathComponent("\(fileId).partial")
    FileManager.default.createFile(atPath: partial.path, contents: nil)
    let handle = try? FileHandle(forWritingTo: partial)
    transfers[fileId] = IncomingTransfer(
      fileId: fileId,
      name: name,
      size: size,
      mimeType: mime,
      totalChunks: totalChunks,
      chunkSize: chunkSize,
      from: peer.peerId,
      fromName: peer.name,
      handle: handle,
      partialURL: partial
    )
    peer.sendJSON(["type": "file-status", "fileId": fileId, "nextIndex": 0])
    log("Receiving \(name) (\(size) bytes) from \(peer.name)", .info)
  }

  private func appendChunk(fileId: String, index: Int, data: Data) {
    guard var t = transfers[fileId] else { return }
    if index != t.nextIndex {
      // Ignore out-of-order for simplicity; client sends sequential
      if index < t.nextIndex { return }
    }
    do {
      try t.handle?.seekToEnd()
      try t.handle?.write(contentsOf: data)
    } catch {
      log("Chunk write failed: \(error.localizedDescription)", .error)
      return
    }
    t.nextIndex = index + 1
    t.received += data.count
    transfers[fileId] = t
    if t.nextIndex >= t.totalChunks || t.received >= t.size {
      finalizeTransfer(fileId)
    }
  }

  private func finalizeTransfer(_ fileId: String) {
    guard var t = transfers.removeValue(forKey: fileId) else { return }
    try? t.handle?.close()
    t.handle = nil
    let finalURL = staging.appendingPathComponent("\(fileId)-\(Self.safeName(t.name))")
    try? FileManager.default.removeItem(at: finalURL)
    try? FileManager.default.moveItem(at: t.partialURL, to: finalURL)
    let small = (try? Data(contentsOf: finalURL))
    let item: [String: Any] = [
      "id": fileId,
      "type": "file",
      "name": t.name,
      "size": t.size,
      "mimeType": t.mimeType,
      "from": t.from,
      "fromName": t.fromName,
      "createdAt": Date().timeIntervalSince1970 * 1000,
    ]
    let keepBuf = (small?.count ?? 0) <= 8 * 1024 * 1024 ? small : nil
    files[fileId] = StoredFile(item: item, data: keepBuf, fileURL: finalURL)
    pushItem(item)
    broadcast(["type": "item", "item": item])
    emitItems()
    log("File ready: \(t.name)", .info)
  }

  private func cancelTransfer(_ fileId: String) {
    if let t = transfers.removeValue(forKey: fileId) {
      try? t.handle?.close()
      try? FileManager.default.removeItem(at: t.partialURL)
    }
  }

  private func pushItem(_ item: [String: Any]) {
    items.append(item)
    if items.count > maxItems {
      let removed = items.removeFirst()
      if (removed["type"] as? String) == "file", let id = removed["id"] as? String {
        if let f = files.removeValue(forKey: id), let url = f.fileURL {
          try? FileManager.default.removeItem(at: url)
        }
      }
    }
  }

  private func broadcast(_ obj: [String: Any], except: PeerConnection? = nil) {
    for (_, peer) in connections where peer.joined && peer !== except {
      peer.sendJSON(obj)
    }
  }

  private func emitReady() {
    let ips = Self.localIPv4s()
    let info = RoomInfo(
      code: roomCode,
      name: roomName,
      hostName: hostName,
      port: Int(port),
      tunnelUrl: nil,
      hasPin: pin != nil
    )
    DispatchQueue.main.async { [weak self] in
      self?.onRoomReady?(info, ips, self?.port ?? 0)
      self?.emitPeers()
      self?.emitItems()
    }
  }

  private func emitPeers() {
    let mapped: [PeerInfo] = peers.compactMap { dict in
      guard let id = dict["id"] as? String, let name = dict["name"] as? String else { return nil }
      return PeerInfo(id: id, name: name, joinedAt: dict["joinedAt"] as? Double)
    }
    DispatchQueue.main.async { [weak self] in
      self?.onPeers?(mapped)
    }
  }

  private func emitItems() {
    let mapped = items.compactMap { Self.parseItem($0) }
    DispatchQueue.main.async { [weak self] in
      self?.onItems?(mapped)
    }
  }

  private func log(_ msg: String, _ level: LogLevel) {
    onLog?(msg, level)
  }

  private func jsonString(_ obj: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let s = String(data: data, encoding: .utf8)
    else { return "{}" }
    return s
  }

  private static func parseItem(_ dict: [String: Any]) -> RoomItem? {
    guard let type = dict["type"] as? String, let id = dict["id"] as? String else { return nil }
    let from = dict["from"] as? String ?? ""
    let fromName = dict["fromName"] as? String ?? "Peer"
    let createdAt = dict["createdAt"] as? Double ?? Date().timeIntervalSince1970 * 1000
    if type == "text" {
      return .text(TextItem(id: id, text: dict["text"] as? String ?? "", from: from, fromName: fromName, createdAt: createdAt))
    }
    if type == "file" {
      return .file(
        FileItem(
          id: id,
          name: dict["name"] as? String ?? "file",
          size: (dict["size"] as? NSNumber)?.int64Value ?? Int64(dict["size"] as? Int ?? 0),
          mimeType: dict["mimeType"] as? String ?? "application/octet-stream",
          from: from,
          fromName: fromName,
          createdAt: createdAt
        )
      )
    }
    return nil
  }

  static func generateCode(length: Int = 6) -> String {
    let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
    return String((0..<length).map { _ in alphabet.randomElement()! })
  }

  static func hexId() -> String {
    var bytes = [UInt8](repeating: 0, count: 8)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return bytes.map { String(format: "%02x", $0) }.joined()
  }

  static func safeName(_ name: String) -> String {
    let cleaned = name.replacingOccurrences(of: #"[<>:"/\\|?*\x00-\x1F]"#, with: "_", options: .regularExpression)
    return String(cleaned.prefix(180)).isEmpty ? "file" : String(cleaned.prefix(180))
  }

  static func localIPv4s() -> [String] {
    var addresses: [String] = []
    var ifaddr: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return ["127.0.0.1"] }
    defer { freeifaddrs(ifaddr) }
    var ptr: UnsafeMutablePointer<ifaddrs>? = first
    while let iface = ptr {
      defer { ptr = iface.pointee.ifa_next }
      guard let addr = iface.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) else { continue }
      var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      let len = socklen_t(MemoryLayout<sockaddr_in>.size)
      getnameinfo(addr, len, &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST)
      let ip = String(cString: hostname)
      if ip != "127.0.0.1", !ip.hasPrefix("169.254.") {
        addresses.append(ip)
      }
    }
    return addresses.isEmpty ? ["127.0.0.1"] : addresses
  }
}

// MARK: - Peer connection

private final class PeerConnection: Equatable {
  static func == (lhs: PeerConnection, rhs: PeerConnection) -> Bool {
    lhs === rhs
  }

  let connection: NWConnection
  weak var host: RoomHost?
  var peerId = ""
  var name = "Guest"
  var joined = false
  private var buffer = Data()
  private var upgraded = false
  private var closed = false

  init(connection: NWConnection, host: RoomHost) {
    self.connection = connection
    self.host = host
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      if case .failed = state { self?.close() }
      if case .cancelled = state { self?.close() }
    }
    connection.start(queue: .global(qos: .userInitiated))
    receiveMore()
  }

  func close() {
    guard !closed else { return }
    closed = true
    connection.cancel()
    host?.workQueue.async { [weak self] in
      guard let self else { return }
      self.host?.removePeerConnection(self)
    }
  }

  func upgradeWebSocket(key: String) {
    upgraded = true
    let accept = WebSocketCodec.acceptKey(from: key)
    let response = """
    HTTP/1.1 101 Switching Protocols\r
    Upgrade: websocket\r
    Connection: Upgrade\r
    Sec-WebSocket-Accept: \(accept)\r
    \r

    """
    connection.send(content: Data(response.utf8), contentContext: .defaultMessage, isComplete: false, completion: .contentProcessed { [weak self] error in
      if let error {
        ocsLog("WS upgrade send failed: \(error)", level: .error)
        self?.close()
      }
    })
  }

  func sendJSON(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let str = String(data: data, encoding: .utf8)
    else { return }
    let frame = WebSocketCodec.encodeText(str)
    connection.send(content: frame, contentContext: .defaultMessage, isComplete: false, completion: .contentProcessed { _ in })
  }

  func sendHTTP(status: Int, headers: [String: String] = [:], body: String) {
    sendHTTP(status: status, headers: headers, bodyData: Data(body.utf8))
  }

  func sendHTTP(status: Int, headers: [String: String] = [:], bodyData: Data) {
    var headerLines = [
      "HTTP/1.1 \(status) \(status == 200 ? "OK" : status == 101 ? "Switching Protocols" : "ERR")",
      "Content-Length: \(bodyData.count)",
      "Connection: close",
      "Access-Control-Allow-Origin: *",
    ]
    for (k, v) in headers { headerLines.append("\(k): \(v)") }
    if headers["Content-Type"] == nil {
      headerLines.append("Content-Type: application/json; charset=utf-8")
    }
    var packet = Data((headerLines.joined(separator: "\r\n") + "\r\n\r\n").utf8)
    packet.append(bodyData)
    connection.send(content: packet, contentContext: .defaultMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
      self?.close()
    })
  }

  private func receiveMore() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1024 * 1024) { [weak self] content, _, isComplete, error in
      guard let self, !self.closed else { return }
      if let content, !content.isEmpty {
        self.buffer.append(content)
        self.processBuffer()
      }
      if error != nil || isComplete {
        self.close()
        return
      }
      self.receiveMore()
    }
  }

  private func processBuffer() {
    if !upgraded {
      if let range = buffer.range(of: Data("\r\n\r\n".utf8)) {
        let headerData = buffer.subdata(in: buffer.startIndex..<range.lowerBound)
        buffer.removeSubrange(buffer.startIndex..<range.upperBound)
        if let req = HTTPRequest.parse(headerData) {
          host?.workQueue.async { [weak self] in
            guard let self else { return }
            self.host?.handleHTTP(request: req, peer: self)
          }
        } else {
          close()
        }
      }
      return
    }

    let frames = WebSocketCodec.decode(buffer: &buffer)
    for frame in frames {
      switch frame {
      case .text(let s):
        host?.workQueue.async { [weak self] in
          guard let self else { return }
          self.host?.handleWSJSON(s, peer: self)
        }
      case .binary(let d):
        host?.workQueue.async { [weak self] in
          guard let self else { return }
          self.host?.handleWSBinary(d, peer: self)
        }
      case .ping(let d):
        let pong = WebSocketCodec.encode(opcode: .pong, payload: d)
        connection.send(content: pong, contentContext: .defaultMessage, isComplete: false, completion: .contentProcessed { _ in })
      case .close:
        close()
      case .pong:
        break
      }
    }
  }
}

struct HTTPRequest {
  let method: String
  let path: String
  let headers: [String: String]
  var query: [String: String] {
    guard let q = path.split(separator: "?").dropFirst().first else { return [:] }
    var out: [String: String] = [:]
    for pair in q.split(separator: "&") {
      let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
      if parts.count == 2 {
        out[parts[0]] = parts[1].removingPercentEncoding ?? parts[1]
      }
    }
    return out
  }

  var isWebSocketUpgrade: Bool {
    (headers["upgrade"] ?? "").lowercased() == "websocket"
  }

  var webSocketKey: String? { headers["sec-websocket-key"] }

  static func parse(_ data: Data) -> HTTPRequest? {
    guard let text = String(data: data, encoding: .utf8) else { return nil }
    let lines = text.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
    guard let requestLine = lines.first else { return nil }
    let parts = requestLine.split(separator: " ")
    guard parts.count >= 2 else { return nil }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
      if line.isEmpty { break }
      if let idx = line.firstIndex(of: ":") {
        let key = String(line[..<idx]).trimmingCharacters(in: .whitespaces).lowercased()
        let value = String(line[line.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
        headers[key] = value
      }
    }
    return HTTPRequest(method: String(parts[0]), path: String(parts[1]), headers: headers)
  }
}
