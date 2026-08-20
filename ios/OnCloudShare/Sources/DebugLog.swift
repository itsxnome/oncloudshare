import Foundation

enum LogLevel: String {
  case debug = "DEBUG"
  case info = "INFO"
  case warn = "WARN"
  case error = "ERROR"
}

struct LogLine: Identifiable, Equatable {
  let id = UUID()
  let date: Date
  let level: LogLevel
  let message: String

  var formatted: String {
    let ts = ISO8601DateFormatter().string(from: date)
    return "[\(ts)] [\(level.rawValue)] \(message)"
  }
}

@MainActor
final class DebugLog: ObservableObject {
  static let shared = DebugLog()
  @Published private(set) var lines: [LogLine] = []
  private let maxLines = 800

  func log(_ message: String, level: LogLevel = .info) {
    let line = LogLine(date: Date(), level: level, message: message)
    lines.append(line)
    if lines.count > maxLines {
      lines.removeFirst(lines.count - maxLines)
    }
    #if DEBUG
    print(line.formatted)
    #endif
  }

  func clear() { lines.removeAll() }

  var allText: String {
    lines.map(\.formatted).joined(separator: "\n")
  }
}

func ocsLog(_ message: String, level: LogLevel = .info) {
  Task { @MainActor in
    DebugLog.shared.log(message, level: level)
  }
}
