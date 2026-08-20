import Foundation

struct PeerInfo: Identifiable, Codable, Hashable {
  let id: String
  let name: String
  var joinedAt: Double?
}

enum RoomItem: Identifiable, Hashable {
  case text(TextItem)
  case file(FileItem)

  var id: String {
    switch self {
    case .text(let t): return t.id
    case .file(let f): return f.id
    }
  }

  var createdAt: Double {
    switch self {
    case .text(let t): return t.createdAt
    case .file(let f): return f.createdAt
    }
  }

  var fromName: String {
    switch self {
    case .text(let t): return t.fromName
    case .file(let f): return f.fromName
    }
  }
}

struct TextItem: Identifiable, Codable, Hashable {
  let id: String
  let text: String
  let from: String
  let fromName: String
  let createdAt: Double
}

struct FileItem: Identifiable, Codable, Hashable {
  let id: String
  let name: String
  let size: Int64
  let mimeType: String
  let from: String
  let fromName: String
  let createdAt: Double
}

struct RoomInfo: Codable, Hashable {
  let code: String
  let name: String
  let hostName: String
  let port: Int?
  var tunnelUrl: String?
  var hasPin: Bool?
}

struct DiscoveredRoom: Identifiable, Hashable {
  var id: String { "\(host):\(port):\(code)" }
  let name: String
  let code: String
  let host: String
  let port: Int
  let hostName: String
}

enum ConnectionState: Equatable {
  case idle
  case connecting
  case connected
  case reconnecting
  case failed(String)
}

struct AppReleaseAsset: Identifiable {
  let id: String
  let name: String
  let downloadURL: URL
  let size: Int64
}
