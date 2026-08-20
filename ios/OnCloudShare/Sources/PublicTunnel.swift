import Foundation
import Network

enum PublicTunnelError: LocalizedError {
  case badResponse
  case missingURL

  var errorDescription: String? {
    switch self {
    case .badResponse: return "Tunnel service returned an invalid response"
    case .missingURL: return "Tunnel service did not provide a public URL"
    }
  }
}

struct TunnelInfo {
  let id: String
  let remoteHost: String
  let remotePort: UInt16
  let maxConn: Int
  let url: URL
}

/// Free public HTTPS tunnel via localtunnel / loca.lt (no cloudflared binary on iOS).
final class PublicTunnel {
  static let shared = PublicTunnel()

  fileprivate let workQueue = DispatchQueue(label: "com.oncloudshare.publictunnel")
  private var workers: [ObjectIdentifier: TunnelBridge] = [:]
  private var info: TunnelInfo?
  private var localPort: UInt16 = 0
  private var running = false
  var onLog: ((String, LogLevel) -> Void)?

  private init() {}

  func start(localPort: UInt16) async throws -> URL {
    await stopAsync()
    let info = try await Self.requestInfo()
    workQueue.sync {
      self.localPort = localPort
      self.info = info
      self.running = true
      let n = max(1, info.maxConn)
      for _ in 0..<n {
        self.spawnBridgeLocked()
      }
    }
    onLog?("Public tunnel \(info.url.absoluteString) → 127.0.0.1:\(localPort)", .info)
    return info.url
  }

  func stop() {
    workQueue.async { [weak self] in self?.stopLocked() }
  }

  func stopAsync() async {
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      workQueue.async { [weak self] in
        self?.stopLocked()
        cont.resume()
      }
    }
  }

  private func stopLocked() {
    running = false
    info = nil
    for (_, w) in workers { w.close() }
    workers.removeAll()
  }

  fileprivate func bridgeDied(_ bridge: TunnelBridge) {
    workers.removeValue(forKey: ObjectIdentifier(bridge))
    guard running, info != nil else { return }
    spawnBridgeLocked()
  }

  private func spawnBridgeLocked() {
    guard running, let info else { return }
    let bridge = TunnelBridge(
      remoteHost: info.remoteHost,
      remotePort: info.remotePort,
      localPort: localPort,
      owner: self
    )
    workers[ObjectIdentifier(bridge)] = bridge
    bridge.start()
  }

  static func requestInfo() async throws -> TunnelInfo {
    let endpoints = ["https://loca.lt/?new", "https://localtunnel.me/?new"]
    var lastError: Error = PublicTunnelError.badResponse
    for ep in endpoints {
      do {
        guard let reqURL = URL(string: ep) else { continue }
        var req = URLRequest(url: reqURL)
        req.timeoutInterval = 20
        req.setValue("OnCloudShare-iOS", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
          throw PublicTunnelError.badResponse
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let urlStr = json["url"] as? String,
              let publicURL = URL(string: urlStr),
              let portNum = json["port"] as? Int
        else { throw PublicTunnelError.missingURL }

        let apiHost = reqURL.host ?? "loca.lt"
        let remoteHost: String = {
          if let ip = json["ip"] as? String, !ip.isEmpty { return ip }
          return apiHost
        }()
        let maxConn = max(1, (json["max_conn_count"] as? Int) ?? 2)
        let id = (json["id"] as? String) ?? publicURL.host ?? "tunnel"
        return TunnelInfo(
          id: id,
          remoteHost: remoteHost,
          remotePort: UInt16(portNum),
          maxConn: maxConn,
          url: publicURL
        )
      } catch {
        lastError = error
      }
    }
    throw lastError
  }
}

private final class TunnelBridge {
  private let remoteHost: String
  private let remotePort: UInt16
  private let localPort: UInt16
  weak var owner: PublicTunnel?
  private var remote: NWConnection?
  private var local: NWConnection?
  private var closed = false
  private let queue = DispatchQueue(label: "com.oncloudshare.tunnel.bridge")

  init(remoteHost: String, remotePort: UInt16, localPort: UInt16, owner: PublicTunnel) {
    self.remoteHost = remoteHost
    self.remotePort = remotePort
    self.localPort = localPort
    self.owner = owner
  }

  func start() {
    let r = NWConnection(
      host: NWEndpoint.Host(remoteHost),
      port: NWEndpoint.Port(rawValue: remotePort)!,
      using: .tcp
    )
    remote = r
    r.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        self.connectLocal()
      case .failed, .cancelled:
        self.close()
      default:
        break
      }
    }
    r.start(queue: queue)
  }

  private func connectLocal() {
    let l = NWConnection(
      host: "127.0.0.1",
      port: NWEndpoint.Port(rawValue: localPort)!,
      using: .tcp
    )
    local = l
    l.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        self.pipe(from: self.remote, to: self.local)
        self.pipe(from: self.local, to: self.remote)
      case .failed, .cancelled:
        self.close()
      default:
        break
      }
    }
    l.start(queue: queue)
  }

  private func pipe(from: NWConnection?, to: NWConnection?) {
    guard let from, let to else { return }
    from.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
      guard let self, !self.closed else { return }
      if let data, !data.isEmpty {
        to.send(content: data, contentContext: .defaultMessage, isComplete: false, completion: .contentProcessed { [weak self] sendErr in
          if sendErr != nil {
            self?.close()
            return
          }
          self?.pipe(from: from, to: to)
        })
        return
      }
      if error != nil || isComplete {
        self.close()
      } else {
        self.pipe(from: from, to: to)
      }
    }
  }

  func close() {
    queue.async { [weak self] in
      guard let self, !self.closed else { return }
      self.closed = true
      self.remote?.cancel()
      self.local?.cancel()
      self.remote = nil
      self.local = nil
      let owner = self.owner
      owner?.workQueue.async {
        owner?.bridgeDied(self)
      }
    }
  }
}
